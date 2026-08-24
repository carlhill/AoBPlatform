import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'node:crypto';
import {
  PendingEmailChangeError,
  assertBackupUsable,
  assertConfirmable,
  assertNotChurning,
  assertStoppable,
  expiresAt as expiryOf,
  MAX_CONFIRMATION_ATTEMPTS,
  warnedAddresses,
  withinCoolingOff,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';
import { EmailComposer } from '../messaging/composer.service';

/** The subject of a change, as resolved from a token before any scope exists. */
export type ResolvedChange = {
  id: string;
  practiceId: string | null;
  practitionerId: string | null;
  requestedEmail: string;
  previousEmail: string | null;
  backupEmail: string | null;
  expiresAt: Date;
  effectiveAt: Date | null;
  attempts: number;
  outcome: string | null;
};

/**
 * Changing a practitioner's own email address, held until it is proved.
 *
 * WHY THIS MATTERS AS MUCH AS THE PRACTICE ONE. A practitioner's address is
 * where their ENROLMENT LINKS go — the messages that let somebody set up a
 * passkey in their name. Redirecting it is the first step to receiving a
 * credential as another person, which is the same threat the administrator
 * flow exists to stop.
 *
 * It was saving directly. A practice administrator changing their address had
 * it held, confirmed from the new address and announced to the old one; a
 * practitioner changing theirs had it applied the moment they pressed save.
 * Same threat, weaker control, and the weaker one sat on the identity that is
 * harder to re-establish.
 *
 * THE OLD ADDRESS DOES NOT AUTHORISE. That design is stronger against takeover
 * and breaks the case the feature exists for: the commonest legitimate reason
 * to change an address is that the old one is gone. Requiring it to authorise
 * means the people who most need this cannot use it, and each becomes a support
 * call where somebody judges identity over the phone.
 *
 * SO: the NEW address proves itself with a code, and the OLD address and the
 * BACKUP are told, with the power to stop it. The backup is what makes that
 * work when the old address is unreachable — a second channel that is not the
 * one being changed.
 *
 * NOT RECORDED IN A PRACTICE'S OUTBOUND QUEUE, unlike an enrolment link. These
 * messages are about a PERSON, and `outbound_items` is practice-anchored: a
 * practice administrator can read and resend what sits in theirs. A
 * practitioner changing their personal address is not the practice's business,
 * and anchoring the record somewhere they can read would publish it. The
 * practitioner's own screen shows the change while it waits, which is the
 * disclosure that belongs to the person it concerns.
 */
@Injectable()
export class PractitionerEmailService {
  private readonly logger = new Logger(PractitionerEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MESSAGING_GATEWAY) private readonly messaging: MessagingGateway,
    private readonly composer: EmailComposer,
  ) {}

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /**
   * Six digits from a CSPRNG.
   *
   * `randomInt` rather than `Math.random` or a sliced hash: the code is the
   * only thing between a mail scanner opening the link and the address being
   * confirmed, so it has to be unguessable inside the attempts allowed.
   */
  private newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }


  /*
   * WHY THIS PERSON RECEIVED THIS, in their own case.
   *
   * The default footer says "this address was given on an application to us",
   * which is true of an applicant and false of a practitioner — and false in
   * the one paragraph whose whole job is to make the message credible. A reader
   * who catches us being wrong about why they got it has every reason to treat
   * the rest as a scam.
   */
  private footerForPractitioner() {
    return this.composer.footerFor(
      'You received this because this address is on your practitioner record with us, or has been given as ' +
        'a backup for it.',
    );
  }

  /** Their backup address, announced to itself so its holder knows. */
  async setBackup(practitionerId: string, backupEmail: string) {
    const practitioner = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });
    if (!practitioner) throw new NotFoundException('We could not find your record.');

    const wanted = backupEmail.trim();
    try {
      assertBackupUsable({ backupEmail: wanted, primaryEmail: practitioner.email });
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    /*
     * STORED UNVERIFIED AND ASKED TO PROVE ITSELF.
     *
     * Unverified rather than refused, because a backup nobody has answered at
     * is still better than none — it is a second channel to TRY. But it must
     * not be presented as proved until somebody has answered, and until now
     * nothing ever asked: `backupEmailVerifiedAt` existed and was never set by
     * anything, so every backup on the platform read as unverified forever and
     * the column said nothing at all.
     *
     * The commonest failure is a typo, not an attack — somebody's partner's
     * address with a letter missing — and nothing would have told them, because
     * nothing writes to it again until the day it matters.
     */
    const code = this.newCode();
    const token = randomBytes(32).toString('base64url');
    const expires = expiryOf(new Date());

    const updated = await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: {
        backupEmail: wanted,
        backupEmailVerifiedAt: null,
        backupEmailToken: token,
        backupEmailCode: code,
        backupEmailExpiresAt: expires,
        backupEmailAttempts: 0,
      },
    });

    const confirmUrl = `${this.consoleUrl()}/practice/confirm-backup?token=${token}`;

    const subject = 'Confirm you are a backup address on AoBPlatform';
    const composed = this.composer.compose(
      subject,
      [
        { text: `${practitioner.givenNames} ${practitioner.familyName} has given this address as their backup.` },
        {
          text:
            'It means that if anybody asks to change the address we use for them, we will tell you here — ' +
            'even if their main address has stopped working.',
        },
        { rule: true },
        { heading: 'Please confirm this address' },
        { text: 'Open the link below and enter this code, so we know the address works and you agree to it.' },
        { code },
        { button: { label: 'Confirm this address', url: confirmUrl } },
        { url: confirmUrl },
        {
          small:
            'A backup we have never had an answer from is a backup we cannot rely on, which is why we ask. ' +
            'It expires in five days.',
        },
        { rule: true },
        {
          small:
            'If you do not know who that is, please tell us — somebody has given your address as theirs, and ' +
            'we would rather hear about it.',
        },
      ],
      this.footerForPractitioner(),
    );

    await this.messaging
      .dispatch({ channel: 'email', to: wanted, subject, body: composed.body, html: composed.html })
      .catch(() => {
        // Recorded regardless. A backup we could not write to is still a
        // backup, and refusing to store it would leave them with none.
        this.logger.warn(`Could not write to the new backup address for practitioner ${practitionerId}.`);
      });

    return {
      backupEmail: updated.backupEmail,
      verified: false,
      detail:
        `We have written to ${wanted} with a code. It counts as a backup once somebody answers there — until ` +
        'then we will still try it, but we cannot promise it works.',
    };
  }

  /** Remove it. Having none is the worse position, so the screen says so. */
  async clearBackup(practitionerId: string) {
    await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: {
        backupEmail: null,
        backupEmailVerifiedAt: null,
        // The proof goes with it. A token left behind would confirm an address
        // that is no longer anybody's backup.
        backupEmailToken: null,
        backupEmailCode: null,
        backupEmailExpiresAt: null,
        backupEmailAttempts: 0,
      },
    });
    return { backupEmail: null, verified: false };
  }

  /**
   * The backup address answers, from the link we sent it.
   *
   * PUBLIC BY NECESSITY. Whoever holds this link is not signed in and may have
   * no account at all — a spouse, a colleague, a practice manager. Requiring a
   * session would mean only the practitioner could confirm their own backup,
   * which proves nothing about whether the OTHER inbox works.
   *
   * The token finds the row and the code proves a human. Same shape as every
   * other proof here, for the same reason: a link alone is opened by scanners.
   */
  async confirmBackup(token: string, code: string) {
    const [found] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        backupEmail: string | null;
        backupEmailCode: string | null;
        backupEmailExpiresAt: Date | null;
        backupEmailAttempts: number;
        backupEmailVerifiedAt: Date | null;
      }>
    >`SELECT * FROM core.practitioner_by_backup_token(${token})`;

    if (!found) throw new NotFoundException('That link is not one of ours, or it has been replaced.');
    if (found.backupEmailVerifiedAt) return { confirmed: true, detail: 'That address was already confirmed.' };

    if (!found.backupEmailExpiresAt || found.backupEmailExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'That link has expired. Ask for the backup address to be saved again and we will send a new one.',
      );
    }

    if (found.backupEmailAttempts >= MAX_CONFIRMATION_ATTEMPTS) {
      throw new BadRequestException(
        'That code has been tried too many times. Ask for the backup address to be saved again.',
      );
    }

    if (found.backupEmailCode !== code.trim()) {
      await this.prisma.practitioner.update({
        where: { id: found.id },
        data: { backupEmailAttempts: { increment: 1 } },
      });
      throw new BadRequestException('That code does not match the one we sent. Check the message and try again.');
    }

    await this.prisma.practitioner.update({
      where: { id: found.id },
      data: {
        backupEmailVerifiedAt: new Date(),
        // Spent. The link must not work twice.
        backupEmailToken: null,
        backupEmailCode: null,
        backupEmailExpiresAt: null,
      },
    });

    this.logger.log(`Backup address confirmed for practitioner ${found.id}.`);
    return {
      confirmed: true,
      detail:
        'Thank you — that address is confirmed. We will write to it if anybody asks to change where our ' +
        'messages go, and not otherwise.',
    };
  }

  /** Ask to change the address. Nothing moves until the new one answers. */
  async request(practitionerId: string, requestedEmail: string, requestedByName: string) {
    const practitioner = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });
    if (!practitioner) throw new NotFoundException('We could not find your record.');

    const requested = requestedEmail.trim();
    if (!requested.includes('@')) {
      throw new BadRequestException('That does not look like an email address.');
    }
    if (practitioner.email && requested.toLowerCase() === practitioner.email.toLowerCase()) {
      throw new BadRequestException('That is already your address, so there is nothing to confirm.');
    }
    if (practitioner.backupEmail && requested.toLowerCase() === practitioner.backupEmail.toLowerCase()) {
      /*
       * MOVING THE PRIMARY ONTO THE BACKUP collapses two channels into one, and
       * does it silently — the warning would arrive at the address that is
       * about to become the primary, so the only witness is the destination.
       * They can do it in two steps if they mean it; the point is that the
       * second step is visible.
       */
      throw new BadRequestException(
        'That is your backup address. Choose a different one for your main address, or change your backup ' +
          'first — otherwise both would be the same inbox and there would be nowhere to warn you.',
      );
    }

    const requestedAt = new Date();

    /*
     * CHURN IS ITS OWN SIGNAL. Three attempts inside a month proves nothing on
     * its own and is a pattern worth stopping for, whatever each one claimed.
     * Counted over REQUESTS rather than completions, because the attempts are
     * the behaviour.
     */
    const monthAgo = new Date(requestedAt);
    monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    const recent = await this.prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.count({ where: { practitionerId, requestedAt: { gte: monthAgo } } }),
    );
    try {
      assertNotChurning(recent);
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const code = this.newCode();
    const confirmToken = randomBytes(32).toString('base64url');
    const stopToken = randomBytes(32).toString('base64url');

    const created = await this.prisma.withPractitioner(practitionerId, async (tx) => {
      // A second request supersedes the first rather than queueing behind it,
      // and is recorded rather than dropped: two attempts to move one address
      // inside five days is itself worth somebody seeing.
      await tx.pendingEmailChange.updateMany({
        where: { practitionerId, outcome: null },
        data: { outcome: 'superseded', outcomeAt: requestedAt, outcomeBy: requestedByName },
      });

      return tx.pendingEmailChange.create({
        data: {
          practitionerId,
          requestedEmail: requested,
          previousEmail: practitioner.email,
          backupEmail: practitioner.backupEmail,
          requestedAt,
          requestedByName,
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

    const confirmSubject = 'Confirm your new AoBPlatform address';
    const confirm = this.composer.compose(
      confirmSubject,
      [
        { text: 'You asked us to use this address for you on AoBPlatform. Nothing has changed yet.' },
        { heading: 'Enter this code to confirm' },
        { code },
        { button: { label: 'Confirm this address', url: confirmUrl } },
        { url: confirmUrl },
        {
          small:
            'The code is what confirms it — a scanner opening the link cannot confirm it for you. It expires ' +
            'in five days.',
        },
        { rule: true },
        {
          small:
            'If you were not expecting this, do nothing and it lapses. We have also told the address it would ' +
            'replace, so somebody else can stop it.',
        },
      ],
      this.footerForPractitioner(),
    );

    await this.messaging
      .dispatch({
        channel: 'email',
        to: requested,
        subject: confirmSubject,
        body: confirm.body,
        html: confirm.html,
      })
      .catch(() => this.logger.error(`Could not write to the new address for practitioner ${practitionerId}.`));

    /*
     * THE OLD ADDRESS AND THE BACKUP, both able to stop it. The new address
     * belongs to whoever asked, so telling them checks nothing; these two are
     * the channels the requester does not control by virtue of having asked.
     */
    const warn = warnedAddresses({
      previousEmail: practitioner.email,
      backupEmail: practitioner.backupEmail,
      requestedEmail: requested,
    });

    const warnSubject = 'Somebody asked to change your AoBPlatform address';
    const warning = this.composer.compose(
      warnSubject,
      [
        { text: `${requestedByName} asked us to change the address we use for them to ${requested}.` },
        {
          text:
            'Nothing has changed yet. It only takes effect if somebody confirms it from the new address, and ' +
            'we are telling you first so that you can stop it.',
        },
        { button: { label: 'This was not me — stop it', url: stopUrl } },
        { url: stopUrl },
        {
          small:
            'That link keeps working for a week AFTER a change goes through, so if you are reading this late ' +
            'it is not too late.',
        },
        { rule: true },
        {
          small:
            'We tell you because changing where our messages go is the first step somebody would take to ' +
            'receive a sign-in link in your name.',
        },
      ],
      this.footerForPractitioner(),
    );

    for (const address of warn) {
      await this.messaging
        .dispatch({
          channel: 'email',
          to: address,
          subject: warnSubject,
          body: warning.body,
          html: warning.html,
        })
        .catch(() => this.logger.error(`Could not warn an address about the change on ${practitionerId}.`));
    }

    if (warn.length === 0) {
      /*
       * NOBODY TO TELL. No old address and no backup, so this change has no
       * witness at all. Not refused — somebody genuinely new has to be able to
       * set a first address — but logged loudly, because it is the shape an
       * account takeover would take if it could.
       */
      this.logger.warn(
        `Address change on practitioner ${practitionerId} had no old address and no backup to warn. ` +
          'Nobody but the requester knows about it.',
      );
    }

    return {
      id: created.id,
      requestedEmail: created.requestedEmail,
      expiresAt: created.expiresAt.toISOString(),
      warned: warn.length,
      unwitnessed: warn.length === 0,
    };
  }

  /** What their own screen shows while a change is waiting. */
  async live(practitionerId: string) {
    const row = await this.prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({
        where: { practitionerId, outcome: null },
        orderBy: { requestedAt: 'desc' },
      }),
    );
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;

    return {
      id: row.id,
      requestedEmail: row.requestedEmail,
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** The new address answers, with the code from its own message. */
  async confirm(found: ResolvedChange, code: string) {
    const practitionerId = found.practitionerId;
    if (!practitionerId) throw new NotFoundException('That change could not be read.');

    try {
      assertConfirmable(found, new Date());
    } catch (err) {
      if (err instanceof PendingEmailChangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const row = await this.prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { id: found.id } }),
    );
    if (!row) throw new NotFoundException('That change could not be read.');

    if (row.confirmCode !== code.trim()) {
      await this.prisma.withPractitioner(practitionerId, (tx) =>
        tx.pendingEmailChange.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }),
      );
      throw new BadRequestException('That code does not match the one we sent. Check the message and try again.');
    }

    const at = new Date();
    await this.prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.update({
        where: { id: row.id },
        // outcomeBy is the ADDRESS that answered, never free text from whoever
        // answered it.
        data: { outcome: 'confirmed', outcomeAt: at, outcomeBy: row.requestedEmail, effectiveAt: at },
      }),
    );

    /*
     * THE PASSKEY IS NOT REVOKED, and this is where a practitioner differs from
     * a practice administrator. That account belongs to the PRACTICE and
     * changes hands, so revoking is right — it is what stops the previous
     * holder signing in after a genuine handover. A practitioner's credential
     * is theirs and does not change hands; revoking it would punish somebody
     * for updating their own address and leave them unable to sign in and fix
     * anything.
     */
    await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: { email: row.requestedEmail },
    });

    this.logger.log(`Practitioner ${practitionerId} confirmed a new address.`);
    return {
      confirmed: true,
      email: row.requestedEmail,
      detail: 'That is now your address. Your sign-in is unchanged — you keep the passkey you already have.',
    };
  }

  /**
   * "This was not me", from the old address or the backup.
   *
   * Allowed for seven days AFTER it took effect, not only before. The request
   * window catches a change nobody noticed being ASKED for; this catches one
   * nobody noticed HAPPENING, which is the likelier miss — the warning and the
   * effect both arrive while somebody is away.
   */
  async stop(found: ResolvedChange) {
    const practitionerId = found.practitionerId;
    if (!practitionerId) throw new NotFoundException('That change could not be read.');

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

    await this.prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.update({
        where: { id: found.id },
        data: {
          outcome: 'stopped',
          outcomeAt: now,
          outcomeBy: found.previousEmail ?? found.backupEmail ?? 'unknown',
        },
      }),
    );

    /*
     * PUT BACK if it had already taken effect. Stopping a change that has
     * happened means undoing it, not merely marking it stopped — otherwise the
     * person objecting still cannot receive anything.
     */
    if (undone) {
      await this.prisma.practitioner.update({
        where: { id: practitionerId },
        data: { email: found.previousEmail },
      });
    }

    this.logger.warn(`Address change on practitioner ${practitionerId} was STOPPED.`);
    return {
      stopped: true,
      detail: undone
        ? 'The change has been undone and your old address is back. Somebody here will look at the account.'
        : 'The change has been stopped and nothing was altered. Somebody here will look at the account.',
    };
  }
}
