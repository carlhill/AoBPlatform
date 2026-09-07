import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  ) {}

  /** The token names one open, unexpired request, or it names nothing. */
  private async resolve(token: string) {
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException('This link is not valid.');
    return this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const request = await tx.captureRequest.findFirst({ where: { tokenHash: parsed.tokenHash } });
      if (!request) throw new NotFoundException('This link is not valid.');
      if (request.status !== 'open') throw new GoneException('This link has already been used or closed.');
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new GoneException('This link has expired. Contact the practice for a new one.');
      }
      const agreement = await tx.agreement.findFirst({ where: { id: request.agreementId } });
      if (!agreement) throw new NotFoundException('This link is not valid.');
      const practice = await tx.practice.findFirst({});
      return { practiceId: parsed.practiceId, request, agreement, practiceName: practice?.name ?? null };
    });
  }

  /**
   * What the patient is being asked to agree to — only once they have proved
   * who they are.
   */
  async read(token: string) {
    const { practiceId, request, agreement, practiceName } = await this.resolve(token);

    if (agreement.status === 'verification_failed') {
      // 423 Locked: the person, not the link, is what is locked.
      throw new HttpException('Verification is locked. Contact the practice.', 423);
    }
    if (agreement.status !== 'awaiting_signature') {
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
    };
  }

  /** Yes. Everything after this is the existing signature path, unchanged. */
  async approve(
    token: string,
    method: 'tap_to_approve',
    ipAddress?: string,
    affirmations: readonly string[] = [],
  ) {
    const { practiceId, request, agreement } = await this.resolve(token);
    if (agreement.status !== 'awaiting_signature' || !agreement.particularsLockedAt) {
      throw new ConflictException('Confirm your details and review the agreement first.');
    }
    // sign() binds the verification event, completes THIS capture request
    // (closing every other open channel, FR-2.7) and attempts write-back.
    const signed = await this.agreements.sign(practiceId, agreement.id, {
      method,
      channel: request.channel,
      captureRequestId: request.id,
      ipAddress,
      affirmations: [...affirmations],
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
      if (agreement.status === 'verification_failed') throw new HttpException('Verification is locked. Contact the practice.', 423);
      if (!agreement.verificationEventId) throw new ConflictException('Confirm your details first.');
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
