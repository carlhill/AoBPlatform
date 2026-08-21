import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AmendmentError,
  ContactError,
  assertAmendmentAllowed,
  assertContactsIndependent,
  checksAffectedBy,
  diffApplication,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The applicant's own view of their application, and their ability to correct it.
 *
 * Everything here is reached with a bearer token and no session, so every read
 * and every write goes through a SECURITY DEFINER function: there is no
 * practice context to satisfy RLS with, and through the ordinary client each of
 * these would return zero rows and report "no such application" rather than
 * failing loudly.
 */
@Injectable()
export class ApplicantService {
  private readonly logger = new Logger(ApplicantService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the verification PAGE may know before a code is entered.
   *
   * Returns whether there is anything to do and how many attempts remain, and
   * nothing else — notably not the practice name. The page is reached by a URL
   * that may have been forwarded, and naming the practice would confirm to
   * whoever holds the link that this entity applied to us.
   */
  async emailVerificationState(token: string) {
    if (!token || token.length < 16) {
      throw new NotFoundException('That verification link is not valid.');
    }
    const [row] = await this.prisma.$queryRaw<Array<{ state: string; attemptsLeft: number }>>`
      SELECT * FROM email_verification_state(${token})`;
    if (!row) throw new NotFoundException('That verification link is not valid.');
    return { state: row.state, attemptsLeft: Number(row.attemptsLeft) };
  }

  /**
   * Confirm the applicant can read mail at the address they gave.
   *
   * TWO PHASE, and the second phase is the one that matters. A bare
   * confirmation link is consumed by a GET, and plenty of things issue a GET
   * that are not the recipient: corporate mail scanners, link-preview bots,
   * antivirus gateways, and the "safe links" rewriting several providers apply
   * to every URL passing through them. Each would have marked an address
   * confirmed with no human involved — and the signal would have been weakest
   * exactly where it mattered most, at a practice on managed corporate mail.
   *
   * So the link only opens a page. Someone has to read the message and type six
   * digits. A scanner may fetch the URL all it likes; fetching does nothing.
   *
   * What this proves stays narrow: somebody can read that mailbox. NOT that the
   * address belongs to the practice, NOT who they are, and NOT that they may
   * act for the entity. A free webmail address verifies exactly as well as a
   * practice one, so this never substitutes for the entitlement check.
   */
  async verifyEmail(token: string, code: string) {
    if (!token || token.length < 16) {
      throw new NotFoundException('That verification link is not valid.');
    }
    if (!/^\d{6}$/.test((code ?? '').trim())) {
      throw new BadRequestException('The code is six digits. Check the email and type it exactly.');
    }

    const [confirmed] = await this.prisma.$queryRaw<Array<{ id: string; name: string; adminEmail: string }>>`
      SELECT * FROM consume_email_verification(${token}, ${code.trim()})`;

    if (confirmed) {
      this.logger.log(`Application ${confirmed.id} confirmed control of its admin email address.`);
      return { verified: true, name: confirmed.name, email: confirmed.adminEmail };
    }

    // Nothing consumed. Count the attempt FIRST — a cap that is only applied on
    // success is not a cap at all, and an unlimited six-digit code is a
    // four-digit code with extra steps.
    await this.prisma.$executeRaw`SELECT record_verification_attempt(${token})`;

    const state = await this.emailVerificationState(token).catch(() => null);

    if (state?.state === 'locked') {
      throw new BadRequestException(
        'Too many wrong codes, so this link is now locked. Reply to the email we sent you and we will issue a ' +
          'new one.',
      );
    }
    if (state?.state === 'expired') {
      throw new BadRequestException(
        'That code has expired. Reply to the email we sent you and we will issue a new one.',
      );
    }
    if (state?.state === 'already_verified') {
      throw new BadRequestException('That address is already confirmed. There is nothing further to do.');
    }

    throw new BadRequestException(
      `That code does not match. ${state ? `${state.attemptsLeft} attempt(s) left before this link locks.` : ''}`.trim(),
    );
  }

  /** Re-issue, when a link has expired or never arrived. */
  async resendVerification(statusToken: string) {
    const row = await this.find(statusToken);
    return { practiceId: String(row.id), adminEmail: row.adminEmail as string | null };
  }

  private async find(token: string) {
    if (!token || token.length < 16) {
      // Refused on shape before touching the database, so a short or empty
      // token cannot become a scan of the table.
      throw new NotFoundException('No application matches that link.');
    }
    const [row] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM find_amendable_application(${token})`;
    if (!row) throw new NotFoundException('No application matches that link.');
    return row;
  }

  /**
   * The three gates, and nothing else.
   *
   * Deliberately the SAME three rows the applicant saw when they submitted, so
   * the status page is recognisably the confirmation screen rather than a new
   * vocabulary to learn at the moment they are anxious about a delay.
   */
  async status(token: string) {
    const row = await this.find(token);
    const state = String(row.validationState);

    return {
      reference: row.id,
      name: row.name,
      submittedAt: row.createdAt,
      amendmentCount: Number(row.amendmentCount ?? 0),
      state,
      gates: {
        // Passing gate 1 and 2 is implied by the application existing at all:
        // neither the checksum nor the register gate can be got past.
        checksum: 'passed',
        register: row.abnStatus ? 'passed' : 'passed',
        human: state === 'pending' ? 'waiting' : state === 'validated' ? 'passed' : 'failed',
      },
      // Whether they can still correct anything. Not WHY a decision went the
      // way it did — that was emailed, on a channel we chose.
      amendable:
        state === 'pending' &&
        Boolean(row.correctionExpiresAt) &&
        new Date(String(row.correctionExpiresAt)).getTime() > Date.now(),
      correctionExpiresAt: row.correctionExpiresAt ?? null,
      correctionReason: row.correctionReason ?? null,
    };
  }

  /** The applicant's own values, for the correction form. */
  async amendableApplication(token: string) {
    return this.presentApplication(await this.find(token));
  }

  /**
   * One projection, used by both the token route and the console route.
   *
   * Two functions returning different subsets of the same row is how one of
   * them quietly becomes the one that leaks — so there is one, and both callers
   * get exactly what an applicant may see.
   */
  private presentApplication(row: Record<string, unknown>) {
    return {
      reference: row.id,
      state: row.validationState,
      // Amendable means BOTH still pending AND inside the window. A page that
      // says "you can correct this" and then refuses on submit is worse than
      // one that says the window has closed.
      amendable:
        row.validationState === 'pending' &&
        Boolean(row.correctionExpiresAt) &&
        new Date(String(row.correctionExpiresAt)).getTime() > Date.now(),
      correctionExpiresAt: row.correctionExpiresAt ?? null,
      correctionReason: row.correctionReason ?? null,
      correctionRequestedByName: row.correctionRequestedByName ?? null,
      // Shown, and not editable — so the applicant can see WHY the ABN is
      // fixed rather than wondering where the field went.
      locked: {
        abn: row.abn,
        legalName: row.legalName,
        entityType: row.entityType,
        abnStatus: row.abnStatus,
      },
      values: {
        name: row.name,
        website: row.website,
        adminName: row.adminName,
        adminEmail: row.adminEmail,
        adminPhone: row.adminPhone,
        adminPosition: row.adminPosition,
        managerName: row.managerName,
        managerEmail: row.managerEmail,
        managerPhone: row.managerPhone,
        managerPosition: row.managerPosition,
        headOfficeLine1: row.headOfficeLine1,
        headOfficeLine2: row.headOfficeLine2,
        headOfficeSuburb: row.headOfficeSuburb,
        headOfficeState: row.headOfficeState,
        headOfficePostcode: row.headOfficePostcode,
        statedPractitionerCount: row.statedPractitionerCount,
      },
    };
  }

  /**
   * Apply a correction.
   *
   * Order matters and is deliberate:
   *   1. work out what ACTUALLY changed, so a form posting every field back
   *      does not record sixteen amendments of which fifteen are no-ops
   *   2. refuse the whole thing if any part of it is not amendable
   *   3. re-run the contact-independence rule against the RESULT, because an
   *      amendment is the one path that could otherwise introduce a clash into
   *      an application that did not have one
   *   4. record each change, append-only, BEFORE the practice row moves
   *   5. move the practice row
   */
  async amend(token: string, input: Record<string, unknown>) {
    const row = await this.find(token);

    /*
     * THE WINDOW APPLIES TO THE LINK, NOT TO THE RIGHT TO CORRECT.
     *
     * This path is reached with a bearer token from an email, so the window is
     * the whole point: a correction link with no expiry is a standing
     * credential sitting in an inbox indefinitely. The console path
     * (amendByPractice) has no window, because there the authorisation is a
     * session rather than a link, and a session has its own lifetime.
     */
    const expiresAt = row.correctionExpiresAt ? new Date(String(row.correctionExpiresAt)) : null;
    if (!expiresAt) {
      throw new BadRequestException(
        'This application is not open for correction. If you need to change something, reply to the email we ' +
          'sent you and we will open it.',
      );
    }
    if (expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        `This correction link expired on ${expiresAt.toISOString().slice(0, 10)}. Reply to the email we sent ` +
          'you and we will send another.',
      );
    }

    return this.applyAmendment(row, input);
  }

  /**
   * The same correction, made from the console by a practice administrator.
   *
   * No window, deliberately. The five-day expiry exists to stop an emailed
   * bearer link living forever in an inbox; it is a property of the LINK, not
   * of the right to correct. Someone signed in to the console is authorised by
   * their session, which has its own lifetime and its own revocation.
   *
   * Every other rule is identical and comes from the same function: the ABN
   * cannot move, amendments are appended rather than applied over the top, and
   * a correction that would leave two contacts sharing a handset is refused.
   */
  private async applyAmendment(row: Record<string, unknown>, input: Record<string, unknown>) {
    const practiceId = String(row.id);

    const changes = diffApplication(row, input);

    try {
      assertAmendmentAllowed({ validationState: String(row.validationState), changes });
    } catch (err) {
      if (err instanceof AmendmentError) throw new BadRequestException(err.message);
      throw err;
    }

    // The result of applying the amendment, checked before anything is written.
    const after = { ...row, ...Object.fromEntries(changes.map((c) => [c.field, c.to])) };
    try {
      assertContactsIndependent({
        adminEmail: String(after.adminEmail ?? ''),
        adminPhone: String(after.adminPhone ?? ''),
        managerEmail: after.managerEmail as string | null,
        managerPhone: after.managerPhone as string | null,
      });
    } catch (err) {
      if (err instanceof ContactError) throw new BadRequestException(err.message);
      throw err;
    }

    const recorded = await this.prisma.$queryRaw<Array<{ checkKey: string }>>`
      SELECT * FROM recorded_check_keys(${practiceId}::uuid)`;
    const recordedKeys = recorded.map((r) => r.checkKey);

    const value = (field: string) => {
      const change = changes.find((c) => c.field === field);
      return change ? change.to : null;
    };

    for (const change of changes) {
      // Which checks THIS change bears on, computed now rather than derived
      // later: the field-to-check mapping is versioned with the catalogue, and
      // the answer must be the one that was true when the change was made.
      const affected = checksAffectedBy([change], recordedKeys);
      await this.prisma.$executeRaw`
        SELECT record_amendment(
          ${practiceId}::uuid, ${change.field}, ${change.from}, ${change.to},
          ${String(row.adminName ?? 'the applicant')}, ${String(row.adminEmail ?? '')},
          ${affected}::text[])`;
    }

    const count = value('statedPractitionerCount');
    await this.prisma.$executeRaw`
      SELECT apply_amendment(
        ${practiceId}::uuid,
        ${value('name')}, ${value('website')},
        ${value('adminName')}, ${value('adminEmail')}, ${value('adminPhone')}, ${value('adminPosition')},
        ${value('managerName')}, ${value('managerEmail')}, ${value('managerPhone')}, ${value('managerPosition')},
        ${value('headOfficeLine1')}, ${value('headOfficeLine2')}, ${value('headOfficeSuburb')},
        ${value('headOfficeState')}, ${value('headOfficePostcode')},
        ${count === null ? null : Number(count)}::integer)`;

    const affectedChecks = checksAffectedBy(changes, recordedKeys);
    if (affectedChecks.length > 0) {
      // Worth a log line: a reviewer's completed work now attests to a value
      // the application no longer contains, and the dossier flags it.
      this.logger.warn(
        `Application ${practiceId} was amended in a way that bears on ${affectedChecks.length} already-recorded ` +
          `check(s): ${affectedChecks.join(', ')}. The reviewer is shown this on the dossier.`,
      );
    }

    return {
      reference: practiceId,
      changed: changes.map((c) => c.field),
      affectedChecks,
    };
  }
}
