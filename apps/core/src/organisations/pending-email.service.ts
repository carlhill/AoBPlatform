import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'node:crypto';
import {
  PendingEmailChangeError,
  afterStop,
  assertConfirmable,
  assertMayRequest,
  assertMayRequestGroupEmail,
  assertStoppable,
  expiresAt as expiryOf,
  recipientsFor,
  recipientsForGroupEmail,
  withinCoolingOff,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { PracticeAdminService } from '../identity/practice-admin.service';
import type { Actor } from '../auth/actor.decorator';
import type { ResolvedChange } from '../identity/practitioner-email.service';

type LivePendingChange = {
  id: string;
  requestedEmail: string;
  requestedByName: string;
  requestedAt: string;
  expiresAt: string;
};

/**
 * Holding a change to the administrator's email address until it is confirmed.
 *
 * The rules live in `@aobplatform/domain/pending-email-change`, including why
 * the OLD address is written to and why that is the recipient that matters.
 * This is the part that talks to the database, the mailer and Keycloak.
 */
@Injectable()
export class PendingEmailService {
  private readonly logger = new Logger(PendingEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reviewTasks: ReviewTasksService,
    private readonly practiceAdmin: PracticeAdminService,
    @Inject(MESSAGING_GATEWAY) private readonly messaging: MessagingGateway,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Six digits, from a CSPRNG.
   *
   * `randomInt` rather than `Math.random`, and rather than slicing a hash: the
   * code is the only thing standing between a scanner opening the link and the
   * address being confirmed, so it has to be unguessable within the five
   * attempts the domain allows.
   */
  private newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async request(
    practiceId: string,
    input: {
      requestedEmail: string;
      previousAdminEmail: string | null;
      previousGroupEmail: string | null;
      requestedByName: string;
      otherContactEmails: (string | null)[];
    },
  ) {
    try {
      assertMayRequest({
        requestedEmail: input.requestedEmail,
        currentAdminEmail: input.previousAdminEmail,
        otherContactEmails: input.otherContactEmails,
      });
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const requestedAt = new Date();
    const code = this.newCode();
    const confirmToken = randomBytes(32).toString('base64url');
    const stopToken = randomBytes(32).toString('base64url');

    const created = await this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * A SECOND REQUEST SUPERSEDES THE FIRST rather than queueing behind it.
       * Recorded rather than deleted: two attempts to move the same address
       * inside five days is itself the signal a reviewer wants. Scoped to
       * `field: 'adminEmail'` — a live groupEmail change is a different
       * request and must not be knocked out by this one.
       */
      await tx.pendingEmailChange.updateMany({
        where: { practiceId, field: 'adminEmail', outcome: null },
        data: { outcome: 'superseded', outcomeAt: requestedAt, outcomeBy: input.requestedByName },
      });

      return tx.pendingEmailChange.create({
        data: {
          practiceId,
          field: 'adminEmail',
          requestedEmail: input.requestedEmail.trim(),
          previousEmail: input.previousAdminEmail,
          previousGroupEmail: input.previousGroupEmail,
          requestedAt,
          requestedByName: input.requestedByName,
          expiresAt: expiryOf(requestedAt),
          confirmToken,
          confirmCode: code,
          stopToken,
        },
      });
    });

    const base = this.consoleUrl();
    const confirmUrl = `${base}/practice/confirm-email?token=${confirmToken}`;
    const stopUrl = `${base}/practice/stop-email-change?token=${stopToken}`;

    const recipients = recipientsFor({
      requestedEmail: input.requestedEmail,
      previousAdminEmail: input.previousAdminEmail,
      previousGroupEmail: input.previousGroupEmail,
    });

    for (const recipient of recipients) {
      const sent =
        recipient.role === 'confirm'
          ? await this.practiceAdmin.onAdminEmailChangeRequested({
              to: recipient.to,
              requestedByName: input.requestedByName,
              confirmUrl,
              code,
              expiresAt: expiryOf(requestedAt),
            })
          : await this.practiceAdmin.onAdminEmailChangeNotified({
              to: recipient.to,
              requestedEmail: input.requestedEmail,
              previousEmail: input.previousAdminEmail,
              requestedByName: input.requestedByName,
              requestedAt,
              stopUrl,
              // The group address is told what happened; the OLD address is
              // told it can stop it. Both get the link -- whoever still reads
              // the practice's mail should be able to object -- but the wording
              // differs, because "your address is being moved" and "the
              // practice's administrator address is being moved" are not the
              // same message.
              addressedToFormerHolder: recipient.role === 'notify_old',
            });

      if (!sent.notified) {
        // Not fatal, and deliberately so: a change that could not be announced
        // must not thereby be applied. It stays pending and unconfirmed, which
        // is the safe end of the failure.
        this.logger.error(`Could not tell ${recipient.role} about the email change on practice ${practiceId}.`);
      }
    }

    this.logger.log(
      `Administrator email change requested on ${practiceId}: held pending confirmation, ${recipients.length} ` +
        'recipient(s) told.',
    );

    return {
      id: created.id,
      requestedEmail: created.requestedEmail,
      expiresAt: created.expiresAt.toISOString(),
      notified: recipients.map((r) => r.role),
    };
  }

  /**
   * What the practice's own screens show while a change is waiting — for
   * BOTH fields, since a practice may now hold a live adminEmail change and a
   * live groupEmail change at once. Keyed by field so the screen can put the
   * right tag beside the right box without guessing.
   */
  async live(practiceId: string): Promise<Record<'adminEmail' | 'groupEmail', LivePendingChange | null>> {
    const rows = await this.prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findMany({ where: { practiceId, outcome: null }, orderBy: { requestedAt: 'desc' } }),
    );

    const forField = (field: 'adminEmail' | 'groupEmail'): LivePendingChange | null => {
      const row = rows.find((r) => r.field === field);
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return {
        id: row.id,
        requestedEmail: row.requestedEmail,
        requestedByName: row.requestedByName,
        requestedAt: row.requestedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    };

    return { adminEmail: forField('adminEmail'), groupEmail: forField('groupEmail') };
  }

  /**
   * WHOSE CHANGE IS THIS? Resolved before any scope exists, because whoever
   * holds the token has not signed in and carries neither a practice claim nor
   * a practitioner one.
   *
   * The row comes back through a SECURITY DEFINER function that matches the
   * token and returns nothing at all otherwise -- an individually justified
   * escape hatch from RLS (CONVENTIONS.md 6), narrow because it can only ever
   * be entered with an unguessable token that names one row.
   *
   * Public because the controller needs it to decide WHICH service handles the
   * answer: one link, two kinds of subject, and the link cannot say which
   * without telling a stranger something about the account.
   */
  async resolve(token: string, kind: 'confirm' | 'stop'): Promise<ResolvedChange | undefined> {
    const [found] = await this.prisma.$queryRaw<
      ResolvedChange[]
    >`SELECT * FROM core.pending_email_change_by_token(${token}, ${kind})`;
    return found;
  }

  /**
   * The new address answers, with the code from its own message.
   *
   * Pre-tenant: whoever holds the token has not signed in and has no practice
   * scope, so the row is fetched through a SECURITY DEFINER function that
   * matches the token and returns nothing at all otherwise.
   */
  async confirm(token: string, code: string) {
    const [found] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        practiceId: string;
        requestedEmail: string;
        previousEmail: string | null;
        expiresAt: Date;
        attempts: number;
        outcome: string | null;
      }>
    >`SELECT * FROM core.pending_email_change_by_token(${token}, 'confirm')`;

    if (!found) throw new NotFoundException('That confirmation link is not one of ours, or it has been replaced.');

    try {
      assertConfirmable(found, new Date());
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const row = await this.prisma.withPractice(found.practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { id: found.id } }),
    );
    if (!row) throw new NotFoundException('That change could not be read.');

    if (row.confirmCode !== code.trim()) {
      await this.prisma.withPractice(found.practiceId, (tx) =>
        tx.pendingEmailChange.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }),
      );
      throw new BadRequestException('That code does not match the one we sent. Check the message and try again.');
    }

    const at = new Date();

    /*
     * NOW the handover happens, and only now. Revoking passkeys is correct
     * once somebody has proved they hold the new address -- it is what stops
     * the previous holder signing in after a genuine handover. Doing it at
     * REQUEST time was what turned one console session into a lockout.
     */
    const revoked = await this.practiceAdmin
      .handOverPracticeAdminAccountFor(found.practiceId, { email: row.requestedEmail })
      .catch((err: Error) => {
        this.logger.error(`Handover after confirmation failed on ${found.practiceId}: ${err.message}`);
        return { passkeysRevoked: 0, note: `The account could not be handed over: ${err.message}` };
      });

    await this.prisma.withPractice(found.practiceId, async (tx) => {
      await tx.pendingEmailChange.update({
        where: { id: row.id },
        // outcomeBy is the ADDRESS that answered, never free text from whoever
        // answered it.
        data: { outcome: 'confirmed', outcomeAt: at, outcomeBy: row.requestedEmail },
      });

      await tx.practice.update({
        where: { id: found.practiceId },
        data: {
          adminEmail: row.requestedEmail,
          // Proven just now, by this exchange.
          adminEmailVerifiedAt: at,
          adminEmailVerificationToken: null,
          adminEmailVerificationCode: null,
          // Nobody has enrolled against the new address yet; the link that
          // does it goes out below.
          adminPasskeyEnrolledAt: null,
        },
      });

      /*
       * The staff row's copy, brought along. `list` no longer trusts it, but a
       * stale value sitting in a column is a trap for the next reader — and the
       * invite path does use it.
       */
      await tx.staffMember.updateMany({
        where: { practiceId: found.practiceId, consoleRole: 'admin' },
        data: { email: row.requestedEmail },
      });

      await enqueueVaultEvent(tx, {
        type: 'organisation.admin_handover',
        actor: { principalType: 'staff', id: found.practiceId },
        subject: { type: 'Organisation', id: found.practiceId },
        payload: {
          changedBy: row.requestedByName,
          reason: 'Administrator email change, confirmed from the new address.',
          fieldsChanged: 'adminEmail',
          passkeysRevoked: revoked.passkeysRevoked,
          handoverNote: revoked.note,
        },
      });
    });

    this.logger.log(`Administrator email change confirmed on ${found.practiceId}.`);
    return {
      confirmed: true,
      email: row.requestedEmail,
      detail:
        'The address is confirmed and now in force. A link to set up a passkey has been sent to it — the ' +
        'previous one no longer signs in.',
    };
  }

  /**
   * "This was not me", from the old address or the group address.
   *
   * Allowed after expiry, unlike confirming: somebody reading the warning a
   * week late must still be able to object, and refusing them would give the
   * alarm a shorter life than the thing it warns about.
   */
  async stop(token: string, actor?: Actor) {
    const [found] = await this.prisma.$queryRaw<
      Array<{ id: string; practiceId: string; requestedEmail: string; previousEmail: string | null; outcome: string | null }>
    >`SELECT * FROM core.pending_email_change_by_token(${token}, 'stop')`;

    if (!found) throw new NotFoundException('That link is not one of ours.');

    try {
      assertStoppable(found);
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const at = new Date();
    const consequence = afterStop();

    await this.prisma.withPractice(found.practiceId, async (tx) => {
      await tx.pendingEmailChange.update({
        where: { id: found.id },
        data: { outcome: 'stopped', outcomeAt: at, outcomeBy: found.previousEmail ?? 'the practice' },
      });

      await this.reviewTasks.raise(tx, {
        practiceId: found.practiceId,
        kind: consequence.kind,
        subjectType: 'Organisation',
        subjectId: found.practiceId,
        summary: 'Somebody stopped a change to the administrator email address',
        detail: {
          reason:
            'The practice pressed "this was not me" on a change to the address that holds its sign-in. ' +
            'Whether or not the change was genuine, the account is worth looking at.',
          changes: [{ field: 'adminEmail', from: found.previousEmail, to: found.requestedEmail }],
          stopped: true,
        },
        raisedBy: actor?.name ?? 'the practice',
      });
    });

    this.logger.warn(`Administrator email change STOPPED on ${found.practiceId}. Review task raised.`);
    return {
      stopped: true,
      detail:
        'The change has been stopped and the address is unchanged. Somebody here will look at the account — ' +
        'you do not need to do anything else.',
    };
  }

  /**
   * Requesting a change to the SHARED practice address — the groupEmail mirror
   * of {@link request}. Held and proved the same way, for the reason the
   * migration that added this column explains: groupEmail is the witness an
   * adminEmail handover relies on, and a witness that changes unchecked is a
   * witness that can be silenced.
   *
   * NOT A HANDOVER. No Keycloak call anywhere in this method or in {@link
   * confirmGroupEmail} — nobody signs in as groupEmail, so there is nothing to
   * hand over.
   */
  async requestGroupEmail(
    practiceId: string,
    input: { requestedEmail: string; previousGroupEmail: string | null; currentAdminEmail: string | null; requestedByName: string },
  ) {
    try {
      assertMayRequestGroupEmail({
        requestedEmail: input.requestedEmail,
        currentGroupEmail: input.previousGroupEmail,
      });
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const requestedAt = new Date();
    const code = this.newCode();
    const confirmToken = randomBytes(32).toString('base64url');
    const stopToken = randomBytes(32).toString('base64url');

    const created = await this.prisma.withPractice(practiceId, async (tx) => {
      // Scoped to field: 'groupEmail' — a live adminEmail change is a
      // different request and must not be knocked out by this one.
      await tx.pendingEmailChange.updateMany({
        where: { practiceId, field: 'groupEmail', outcome: null },
        data: { outcome: 'superseded', outcomeAt: requestedAt, outcomeBy: input.requestedByName },
      });

      return tx.pendingEmailChange.create({
        data: {
          practiceId,
          field: 'groupEmail',
          requestedEmail: input.requestedEmail.trim(),
          previousEmail: input.previousGroupEmail,
          previousAdminEmail: input.currentAdminEmail,
          requestedAt,
          requestedByName: input.requestedByName,
          expiresAt: expiryOf(requestedAt),
          confirmToken,
          confirmCode: code,
          stopToken,
        },
      });
    });

    const base = this.consoleUrl();
    const confirmUrl = `${base}/practice/confirm-email?token=${confirmToken}`;
    const stopUrl = `${base}/practice/stop-email-change?token=${stopToken}`;

    const recipients = recipientsForGroupEmail({
      requestedEmail: input.requestedEmail,
      previousGroupEmail: input.previousGroupEmail,
      currentAdminEmail: input.currentAdminEmail,
    });

    for (const recipient of recipients) {
      const sent =
        recipient.role === 'confirm'
          ? await this.practiceAdmin.onGroupEmailChangeRequested({
              to: recipient.to,
              requestedByName: input.requestedByName,
              confirmUrl,
              code,
              expiresAt: expiryOf(requestedAt),
            })
          : await this.practiceAdmin.onGroupEmailChangeNotified({
              to: recipient.to,
              requestedEmail: input.requestedEmail,
              previousEmail: input.previousGroupEmail,
              requestedByName: input.requestedByName,
              requestedAt,
              stopUrl,
              addressedToFormerHolder: recipient.role === 'notify_old',
            });

      if (!sent.notified) {
        this.logger.error(`Could not tell ${recipient.role} about the group-email change on practice ${practiceId}.`);
      }
    }

    this.logger.log(
      `Group-email change requested on ${practiceId}: held pending confirmation, ${recipients.length} ` +
        'recipient(s) told.',
    );

    return {
      id: created.id,
      requestedEmail: created.requestedEmail,
      expiresAt: created.expiresAt.toISOString(),
      notified: recipients.map((r) => r.role),
    };
  }

  /**
   * The new shared address answers, with the code from its own message.
   *
   * No Keycloak call, no staff-row sync, no passkey enrolment link — those all
   * exist in {@link confirm} because that address signs somebody in. This one
   * writes a column and stops.
   */
  async confirmGroupEmail(found: ResolvedChange, code: string) {
    const practiceId = found.practiceId;
    if (!practiceId) throw new NotFoundException('That change could not be read.');

    try {
      assertConfirmable(found, new Date());
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const row = await this.prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { id: found.id } }),
    );
    if (!row) throw new NotFoundException('That change could not be read.');

    if (row.confirmCode !== code.trim()) {
      await this.prisma.withPractice(practiceId, (tx) =>
        tx.pendingEmailChange.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }),
      );
      throw new BadRequestException('That code does not match the one we sent. Check the message and try again.');
    }

    const at = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.pendingEmailChange.update({
        where: { id: row.id },
        data: { outcome: 'confirmed', outcomeAt: at, outcomeBy: row.requestedEmail, effectiveAt: at },
      });

      await tx.practice.update({
        where: { id: practiceId },
        data: { groupEmail: row.requestedEmail, groupEmailVerifiedAt: at },
      });

      await enqueueVaultEvent(tx, {
        type: 'organisation.contacts_changed',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Organisation', id: practiceId },
        payload: {
          changedBy: row.requestedByName,
          reason: 'Shared practice email address, confirmed from the new address.',
          fieldsChanged: 'groupEmail',
          passkeysRevoked: 0,
          handoverNote: 'n/a',
        },
      });
    });

    this.logger.log(`Group-email change confirmed on ${practiceId}.`);
    return {
      confirmed: true,
      email: row.requestedEmail,
      detail: 'The address is confirmed and now in force.',
    };
  }

  /** "This was not me", from the old address or the administrator. */
  async stopGroupEmail(found: ResolvedChange, actor?: Actor) {
    const practiceId = found.practiceId;
    if (!practiceId) throw new NotFoundException('That change could not be read.');

    const now = new Date();

    if (found.outcome === 'confirmed') {
      if (!withinCoolingOff(found.effectiveAt, now)) {
        throw new BadRequestException(
          'This change went through more than a week ago, so it cannot be undone from this link. Please tell ' +
            'us straight away and somebody here will look at the account.',
        );
      }
    } else {
      try {
        assertStoppable(found);
      } catch (err) {
        if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
        throw err;
      }
    }

    const undone = Boolean(found.effectiveAt && found.previousEmail);

    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.pendingEmailChange.update({
        where: { id: found.id },
        data: { outcome: 'stopped', outcomeAt: now, outcomeBy: found.previousEmail ?? 'the practice' },
      });

      if (undone) {
        await tx.practice.update({ where: { id: practiceId }, data: { groupEmail: found.previousEmail } });
      }

      const consequence = afterStop();
      await this.reviewTasks.raise(tx, {
        practiceId,
        kind: consequence.kind,
        subjectType: 'Organisation',
        subjectId: practiceId,
        summary: 'Somebody stopped a change to the shared practice email address',
        detail: {
          reason:
            'The practice pressed "this was not me" on a change to the shared practice address. Whether or ' +
            'not the change was genuine, it is worth a look.',
          changes: [{ field: 'groupEmail', from: found.previousEmail, to: found.requestedEmail }],
          stopped: true,
        },
        raisedBy: actor?.name ?? 'the practice',
      });
    });

    this.logger.warn(`Group-email change STOPPED on ${practiceId}. Review task raised.`);
    return {
      stopped: true,
      detail: undone
        ? 'The change has been undone and the shared address is back to what it was. Somebody here will ' +
          'look at the account.'
        : 'The change has been stopped and the address is unchanged. Somebody here will look at the account.',
    };
  }
}
