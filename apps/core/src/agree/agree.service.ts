import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { DrawnSignatureCapture } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AgreementsService } from '../agreements/agreements.service';
import { CorrespondenceService } from '../correspondence/correspondence.service';
import { parseCaptureToken } from '../capture/capture-token';

/**
 * The patient approves — from a link, never an account (CONSULTATION-CAPTURE-PLAN.md §3.3).
 *
 * REQ-PORT-08 decides the shape: the patient holds a single-use token and
 * nothing else. So the practice scope comes FROM THE TOKEN, exactly as
 * `CaptureService.openLink` already derives it, and every read below runs
 * inside that practice's RLS scope like the rest of the system. There is no
 * header a patient could supply and no account they could sign in to.
 *
 * WHY THESE TWO CALLS DID NOT EXIST. `lockParticulars` and `sign` are
 * practice-scoped endpoints — the console's — and a patient cannot call them.
 * `openLink` and `verifyLink` are public but deliberately content-blind
 * (REQ-CHILD-04): they name nobody. What was missing was the step in between:
 * once the person has proved who they are, show them EXACTLY what they are
 * agreeing to, locked and hashed, and let them say yes.
 *
 * WHAT THEY SEE IS WHAT THEY SIGN. The particulars are locked on first read
 * — the artefact is rendered and hashed then (rule 13) — so the screen shows
 * the snapshot the signature will bind to, not a preview that could differ.
 * Nothing about money appears in it (Rule 4); the item numbers do.
 */
@Injectable()
export class AgreeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    // Global module — the one log both audiences read from.
    private readonly correspondence: CorrespondenceService,
    private readonly config: ConfigService,
  ) {}

  /**
   * THE LINK PAGE SHOWS THE DB4 SHEETS (TELEHEALTH-PLAN §8 step 1) — the
   * patient-facing switch, ON unless an environment says `false`.
   *
   * ON BY DEFAULT, AND WHY THAT IS THE SAFE WAY ROUND. With it off, a DB4 sent
   * by link is shown as the general summary — no form, a "no dollar amount"
   * line beside an agreement whose form has amounts on it, and a tap that can
   * never produce a Signed-DB4 (`no_drawn_signature`). Off is a kill switch for
   * an environment that needs the old page back, not the safer state.
   */
  private db4SheetsEnabled(): boolean {
    return this.config.get<string>('LINK_DB4_SHEETS_ENABLED', 'true') !== 'false';
  }

  /** The token names one open, unexpired request, or it names nothing. */
  private async resolve(token: string) {
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException('This link is not valid.');
    return this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!request) throw new NotFoundException('This link is not valid.');
      const link = await linkCheckOf(tx, request.verificationChallengeId);
      /*
       * A LINK CLOSED BY ITS OWN LOCKOUT SAYS LOCKED (423), not "used or
       * closed" (12 Oct 2026): a DB4 link that locks is cancelled in the same
       * transaction (`CaptureService.verifyLink`), and the person holding it
       * should be told the true reason.
       */
      if (request.status !== 'open' && link === 'locked') {
        throw new HttpException('Verification is locked. Contact the practice.', 423);
      }
      if (request.status !== 'open') throw new GoneException('This link has already been used or closed.');
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new GoneException('This link has expired. Contact the practice for a new one.');
      }
      const agreement = await tx.agreement.findFirst({ where: { id: request.agreementId } });
      if (!agreement) throw new NotFoundException('This link is not valid.');
      const practice = await tx.practice.findFirst({});
      const linkVerificationEventId =
        link === 'passed' ? await passedVerificationOf(tx, request.verificationChallengeId) : null;
      return {
        practiceId: parsed.practiceId,
        request,
        agreement,
        practiceName: practice?.name ?? null,
        link,
        linkVerificationEventId,
      };
    });
  }

  /**
   * What the patient is being asked to agree to — only once they have proved
   * who they are.
   */
  async read(token: string) {
    const { practiceId, request, agreement, practiceName, link } = await this.resolve(token);

    if (agreement.status === 'verification_failed' || link === 'locked') {
      // 423 Locked: the person, not the link, is what is locked.
      throw new HttpException('Verification is locked. Contact the practice.', 423);
    }
    /*
     * THIS LINK'S OWN CHALLENGE HAS TO HAVE PASSED, not merely the agreement
     * be at the signing step (TELEHEALTH-PLAN §8 step 1, 12 Oct 2026).
     *
     * The status used to be enough, because only `verifyLink` ever moved a
     * link's agreement to `awaiting_signature`. A DB4 arrives there on its
     * own — locked by the inbound handler, or pushed to the tablet — so the
     * status says nothing about whether the person holding THIS link has
     * typed anything. Read by status alone, a DB4 link would show the whole
     * form, with the patient's name and address on it, to whoever opened it
     * (REQ-CHILD-04, REQ-VER-03). Named test:
     * `a_db4_link_shows_nothing_before_three_identifiers`.
     */
    if (link !== 'passed' || agreement.status !== 'awaiting_signature') {
      // Content-blind until verified (REQ-CHILD-04): the page must not learn
      // whose agreement this is by asking early.
      throw new ConflictException('Confirm your details first.');
    }

    if (!agreement.particularsLockedAt) {
      if (agreement.type !== 'episodic_post') {
        throw new BadRequestException(
          'Only a post-consultation agreement can be approved from a link today. Pre-consultation agreements ' +
            'are signed at the practice.',
        );
      }
      // The server supplies what it knows (REQ-DATA-11): the service record
      // behind this agreement carries the date and the item numbers. The
      // client supplies nothing.
      const record = await this.prisma.withPractice(practiceId, (tx) =>
        tx.serviceRecord.findFirst({ where: { agreementId: agreement.id } }),
      );
      if (!record) throw new BadRequestException('This agreement has no service behind it yet.');
      // A NotImplementedException (501) from here means no s 65C rule set is
      // registered. It propagates as-is: the page says "not yet", honestly.
      await this.agreements.lockParticulars(practiceId, agreement.id, {
        serviceDate: record.serviceDate.toISOString().slice(0, 10),
        mbsItemNumbers: [...record.mbsItemNumbers],
      });
    }

    const locked = await this.agreements.get(practiceId, agreement.id);
    const p = (locked.particulars ?? {}) as Record<string, unknown>;
    /*
     * THE PRACTICE'S OWN DB4, WHERE THE AGREEMENT CAME FROM ONE — the same
     * view the tablet reads off `GET /agreements/:id`, built by the same
     * function from the same envelope (D-2026-09-27-01). Masked before it
     * leaves `buildDb4FormView`: there is no field on it an unmasked Medicare
     * card number could sit in (hard rule 1). Absent for every other agreement,
     * and absent when it cannot be built — which costs the patient a picture
     * of their form and never the signature (hard rule 8).
     */
    const db4Form =
      this.db4SheetsEnabled() && locked.sourcePrintJobId
        ? ((await this.agreements.withDb4FormView(practiceId, locked)).db4Form ?? null)
        : null;
    return {
      state: 'ready' as const,
      agreementId: locked.id,
      channel: request.channel,
      expiresAt: request.expiresAt?.toISOString() ?? null,
      particulars: {
        practiceName,
        providerName: (p.providerName as string | undefined) ?? null,
        agreementType: p.agreementType as string,
        agreementDate: p.agreementDate as string,
        serviceDate: p.serviceDate as string,
        mbsItemNumbers: (p.mbsItemNumbers as string[] | undefined) ?? [],
        patientName: p.patientName as string,
        /**
         * WHO IS SIGNING (Carl, 7 Sep 2026) — the same three facts K-4 now
         * states on the tablet, so a remote signer is told what a signer at
         * the practice is told.
         *
         * FROM THE LOCKED PARTICULARS, NOT FROM THE AGREEMENT ROW. These are
         * the values the render was drawn from and the hash was taken over
         * (rule 13), which is the point: the page states what the document
         * says, not what a second read of the database says now.
         *
         * D7 IS EXPLICIT AND IS NEVER GUESSED (CLAUDE.md §3). `assignorIsPatient`
         * is always on a locked payload, so `null` is unreachable today — but
         * it is `null` rather than `true` because the wrong failure mode for a
         * feature whose whole job is stating who signs would be to state it
         * confidently from an absent field. The page draws no line at all
         * rather than a plausible falsehood.
         */
        assignorIsPatient: typeof p.assignorIsPatient === 'boolean' ? p.assignorIsPatient : null,
        assignorName: (p.assignorName as string | undefined) ?? null,
        assignorRelationship: (p.assignorRelationship as string | undefined) ?? null,
        /** The hash the signature will bind to — shown so the record can be checked later. */
        artefactSha256: locked.renderedArtefactHash,
      },
      /**
       * THE STATEMENTS THE PERSON TICKS, from the rendered document (Carl,
       * 5 Sep 2026; W1) — the same sentences the PDF prints, because they come
       * out of the same stored object it was drawn from.
       *
       * THE REMOTE LINK IS NOT A LESSER SURFACE. The server refuses a
       * signature that does not carry every statement key of the template the
       * agreement was rendered from, whatever the channel; a link that could
       * approve without them would be the one way round the rule.
       *
       * Empty on an agreement locked before templates existed, and the page
       * then behaves exactly as it did.
       */
      statements: statementsOf(locked.renderPayload),
      templateVersion: locked.templateVersion,
      /**
       * THE DB4 SHEETS' INPUTS (TELEHEALTH-PLAN §8 step 1). `db4Form` is the
       * discriminator: present, the page draws the kiosk's own K-3 and K-4
       * (`ParticularsScreen`, `SignatureScreen`); null, it draws what it
       * always drew.
       *
       * `gate` IS WHAT THE KIOSK'S SIGNATURE GATE READS (`evaluateSignatureGate`),
       * so the link enables its signature control from the same facts the
       * tablet does — particulars present, locked, validated, and a rendered
       * hash to bind to (hard rule 2, REQ-REG-06). The server refuses an
       * unlocked signature regardless (`assertSignatureAllowed`).
       */
      db4Form,
      gate: {
        status: locked.status,
        particularsPresent: locked.particulars !== null,
        particularsLockedAt: locked.particularsLockedAt?.toISOString() ?? null,
        ruleSetVersion: locked.ruleSetVersion,
        mappingVersion: locked.mappingVersion,
        renderedArtefactHash: locked.renderedArtefactHash,
      },
      providerAddress: (p.providerAddress as string | undefined) ?? null,
      basicServiceDescription: (p.basicServiceDescription as string | undefined) ?? null,
    };
  }

  /** Yes. Everything after this is the existing signature path, unchanged. */
  async approve(
    token: string,
    method: 'tap_to_approve' | 'drawn',
    ipAddress?: string,
    affirmations: readonly string[] = [],
    signature?: DrawnSignatureCapture,
  ) {
    const { practiceId, request, agreement, link, linkVerificationEventId } = await this.resolve(token);
    // Locked by this link, or by another link to the same agreement: the same answer `read` gives.
    if (link === 'locked' || agreement.status === 'verification_failed') {
      throw new HttpException('Verification is locked. Contact the practice.', 423);
    }
    /*
     * THE LINK'S OWN CHALLENGE, AGAIN — the same gate `read` holds, for the
     * same reason: a DB4 is at the signing step before anybody opens the link,
     * so the status alone would let a link be signed with nothing typed
     * (REQ-VER-03). Named test: `a_db4_link_cannot_be_signed_before_three_identifiers`.
     */
    if (link !== 'passed' || agreement.status !== 'awaiting_signature' || !agreement.particularsLockedAt) {
      throw new ConflictException('Confirm your details and review the agreement first.');
    }
    /*
     * THE SIGNATURE BINDS THE CHECK THIS LINK'S PERSON PASSED, OR NONE
     * (12 Oct 2026). `sign()` binds whatever verification the agreement holds
     * now, and a desk re-push after the link passed swaps a staff check in.
     * Signing from the link then would record the desk's check against a
     * signature made on a phone. Refused with a code; the agreement is
     * untouched and stays signable where it was re-pushed (hard rule 8).
     * Named test: `link_refuses_a_signature_when_the_desk_replaced_the_links_verification`.
     */
    if (!linkVerificationEventId || agreement.verificationEventId !== linkVerificationEventId) {
      throw new ConflictException({
        message:
          'The identity check on this agreement is no longer the one made on this link, so a signature from ' +
          'this link would be recorded against somebody else\'s check.',
        reason: 'link_verification_replaced',
      });
    }
    /*
     * A DRAWING ONLY WHERE THE PAGE OFFERED A PAD (TELEHEALTH-PLAN §8 step 1).
     * The pad is drawn only on a DB4, so a `drawn` arriving for anything else
     * is a client the server did not send a pad to. Refused with a code, the
     * way every refusal on the signature path is (`agreements.service.ts`
     * `sign`), and the general agreement keeps its tap.
     */
    if (method === 'drawn' && !(this.db4SheetsEnabled() && agreement.sourcePrintJobId)) {
      throw new BadRequestException({
        message: 'A drawn signature is taken from a link only on a DB4 sent by the practice.',
        reason: 'drawn_not_offered_on_this_link',
      });
    }
    // sign() binds the verification event, completes THIS capture request
    // (closing every other open channel, FR-2.7) and attempts write-back.
    const signed = await this.agreements.sign(practiceId, agreement.id, {
      method,
      channel: request.channel,
      captureRequestId: request.id,
      ipAddress,
      affirmations: [...affirmations],
      ...(signature ? { signature } : {}),
    });
    return {
      approved: true as const,
      agreementId: signed.id,
      status: signed.status,
      /**
       * Whether the copy has ALREADY landed in the practice's system. Write-back
       * is attempted at once but can be deferred — a patient with no PMS
       * linkage, a PMS that is down — and the FR-9.3 sweep retries. The page
       * must not say "a copy has gone" when it has not; it says "will be placed".
       */
      writtenBack: signed.writtenBackAt !== null,
    };
  }

  /**
   * The patient's half of the correspondence log — the design's P-1 Messages
   * tab. "The patient's portal shows the same rows for their own records —
   * same wording, same timestamps, from their point of view. It is one log
   * with two audiences, not two logs."
   *
   * AUTHENTICATED THE ONLY WAY A PATIENT IS TODAY: by the link they were sent.
   * There is no patient account (REQ-PORT-08), so this follows `/agree/:token`
   * exactly — the token names one practice and one agreement, and the practice
   * scope comes from the token rather than from a header a caller could
   * choose. The rows are then scoped to that agreement's patient by the
   * database.
   *
   * IT WILL NOT ANSWER BEFORE THE PERSON HAS PROVED WHO THEY ARE. Links get
   * forwarded, previewed and scanned; the log names a patient and what was
   * said to them, so it stays closed until the identity challenge behind this
   * token has passed (REQ-CHILD-04). Unlike `read()`, a COMPLETED request is
   * still allowed — reading what was sent to you is the one thing that stays
   * useful after you have signed — and an expired link is not.
   */
  async messages(token: string) {
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException('This link is not valid.');

    const context = await this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!request) throw new NotFoundException('This link is not valid.');
      if (request.status !== 'open' && request.status !== 'completed') {
        throw new GoneException('This link has been closed.');
      }
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new GoneException('This link has expired. Contact the practice for a new one.');
      }
      const agreement = await tx.agreement.findFirst({ where: { id: request.agreementId } });
      if (!agreement) throw new NotFoundException('This link is not valid.');
      const link = await linkCheckOf(tx, request.verificationChallengeId);
      if (agreement.status === 'verification_failed' || link === 'locked') {
        throw new HttpException('Verification is locked. Contact the practice.', 423);
      }
      /*
       * THIS LINK'S CHALLENGE, NOT THE AGREEMENT'S VERIFICATION (12 Oct 2026).
       * A DB4 verified across the desk carries a staff verification before any
       * link is opened, and that is not the link holder proving anything.
       */
      if (link !== 'passed') throw new ConflictException('Confirm your details first.');
      const practice = await tx.practice.findFirst({});
      return { agreement, practiceName: practice?.name ?? null };
    });

    return {
      practiceName: context.practiceName,
      messages: await this.correspondence.listForPatient(parsed.practiceId, context.agreement.patientId, 100),
    };
  }
}

/**
 * HAS THE PERSON HOLDING THIS LINK PROVED WHO THEY ARE — read off the link's
 * OWN challenge, never off the agreement (TELEHEALTH-PLAN §8 step 1).
 *
 * `none` until `openLink` has made a challenge, `open` while one is being
 * answered, `locked` after too many wrong answers, `passed` once the person
 * has stated the identifiers the practice asks for (REQ-VER-03; types only on
 * any record, REQ-VER-04). An agreement can be at the signing step for reasons
 * that have nothing to do with this link — a DB4 is, from the moment it is
 * printed — so this is the only answer to "may this page show anything yet".
 */
async function linkCheckOf(
  tx: Prisma.TransactionClient,
  challengeId: string | null,
): Promise<'none' | 'open' | 'locked' | 'passed'> {
  if (!challengeId) return 'none';
  const challenge = await tx.verificationChallenge.findFirst({ where: { id: challengeId } });
  if (!challenge) return 'none';
  if (challenge.passedAt) return 'passed';
  if (challenge.lockedAt) return 'locked';
  return 'open';
}

/**
 * THE VERIFICATION EVENT THIS LINK'S CHALLENGE PASSED WITH — the id `verifyLink`
 * bound to the agreement. Null if there is none (never passed, or the row is
 * gone), which `approve` reads as "not this link's check".
 */
async function passedVerificationOf(tx: Prisma.TransactionClient, challengeId: string | null): Promise<string | null> {
  if (!challengeId) return null;
  const event = await tx.verificationEvent.findFirst({
    where: { challengeId, outcome: 'passed' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return event?.id ?? null;
}

/**
 * The statement keys and text out of a stored render document. Empty for an
 * agreement locked before the wording became content, which is the honest
 * answer: that agreement has nothing on its record to tick against.
 */
function statementsOf(renderPayload: unknown): { key: string; text: string }[] {
  const payload = renderPayload as { template?: { statements?: unknown } } | null;
  const statements = payload?.template?.statements;
  if (!Array.isArray(statements)) return [];
  return statements
    .filter((s): s is { key: string; text: string } =>
      Boolean(s) && typeof (s as { key?: unknown }).key === 'string' && typeof (s as { text?: unknown }).text === 'string',
    )
    .map((s) => ({ key: s.key, text: s.text }));
}
