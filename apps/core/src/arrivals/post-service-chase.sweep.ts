import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  chaseBandFor,
  daysRemainingInLodgementWindow,
  remoteChannelFor,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { anchorForAgreement } from '../affiliations/agreement-anchor';
import { PrismaService } from '../prisma/prisma.service';
import { CaptureService } from '../capture/capture.service';
import { CaptureLinkDispatcher } from '../auto-capture/capture-link.dispatcher';

const SYSTEM_ACTOR = { principalType: 'system', id: 'post-service-chase' } as const;

/**
 * THIRTY MINUTES AND NOBODY SIGNED (Carl, 11 Sep 2026, step 6; TODO.md
 * "Reminders are the fallback, not the flow").
 *
 * THE 30-MINUTE NUDGE IS THE CASCADE'S FIRST RUNG, NOT THE FLOW. The flow is
 * the desk: the patient comes back to reception, reception hands them the
 * tablet, they approve, done. This exists for the visit where that did not
 * happen — the patient left another way, or it was a telehealth service and
 * there was no desk to come back to. TODO.md's own words: "they run only when
 * the patient did not come back to the desk".
 *
 * AFTER THIS RUNG THE CADENCE IS NOT TIME, IT IS THE WINDOW. REQ-CHASE-05 bands
 * the escalation by DAYS LEFT on the twelve-month lodgement window rather than
 * by elapsed time, and that ladder already exists — `chaseBandFor`,
 * `attemptAllowed`, `chaseNextStep`, the reconciliation queue and the
 * chase-attempt log. This sweep does not reimplement any of it. All it does is
 * open the FIRST remote channel, which is exactly what
 * `AutoCaptureService.captureForServiceRecord` does when an invoice arrives with
 * nothing behind it; from there the item is an ordinary banded item on
 * `ReconciliationService.outstanding()` and `resend` is the next rung.
 *
 * NEVER PAST THE DEADLINE (REQ-CHASE-08). Past the window the item is
 * unbillable, permanently, and a message about it is cost with no possible
 * return. Checked before anything is opened, with the same function every other
 * caller uses.
 *
 * NEVER A CONFIDENTIALITY-FLAGGED PATIENT (REQ-CHASE-03). No outbound contact of
 * any kind, and the check fails closed.
 *
 * NEVER AN 89AA NOTICE (hard rule 7, REQ-END-05, REQ-CHASE-02). A notice is
 * one-way and is never chased. Nothing here can reach one: the sweep reads
 * service records and agreements, the chase-attempt domain refuses `Notice` as a
 * subject, and a CHECK constraint refuses it again at the table.
 *
 * BEHIND A FEATURE FLAG, AND OFF BY DEFAULT (`POST_SERVICE_CHASE_ENABLED`).
 * `ChaseAttemptsService` records what a PERSON did and exposes no way to START a
 * cascade, so there was no existing entry point to wire this to — this is the
 * minimal hook, and it sends real messages, which CLAUDE.md section 7 says to
 * ask about rather than switch on. In dev the outbound queue goes to the sandbox
 * gateway; a practice turns it on deliberately.
 *
 * IT NEVER BLOCKS CARE (hard rule 8). Every branch that declines to chase leaves
 * the service billable and the item on reception's queue.
 */
@Injectable()
export class PostServiceChaseSweep {
  private readonly logger = new Logger(PostServiceChaseSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: CaptureService,
    private readonly links: CaptureLinkDispatcher,
    private readonly config: ConfigService,
  ) {}

  /**
   * HOW LONG THE DESK GETS. Thirty minutes from the moment the platform learned
   * the service had been rendered — long enough for the patient to walk from the
   * consulting room to reception, be handed the tablet and read it, and short
   * enough that a patient who left is contacted the same morning.
   */
  static readonly DESK_GRACE_MS = 30 * 60 * 1000;

  private enabled(): boolean {
    return this.config.get<string>('POST_SERVICE_CHASE_ENABLED', 'false') === 'true';
  }

  @Interval(60_000)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    const practiceIds = await this.practicesWithWaitingServices();
    for (const practiceId of practiceIds) {
      try {
        await this.sweepPractice(practiceId);
      } catch (err) {
        // A sweep that throws must not stop the next practice's, and must never
        // stop a practice billing. Logged without a patient in it (REQ-LOG-08).
        this.logger.error(`Post-service chase sweep failed for practice ${practiceId}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * WHICH PRACTICES HAVE ANYTHING WAITING. Read with the admin connection
   * because a sweep has no practice scope of its own; it yields IDS ONLY, and
   * every read that follows goes back through `withPractice` so RLS scopes it.
   * The same shape the other sweeps in this codebase use.
   */
  private async practicesWithWaitingServices(): Promise<string[]> {
    const cutoff = new Date(Date.now() - PostServiceChaseSweep.DESK_GRACE_MS);
    /*
     * A SECURITY DEFINER FUNCTION, exactly as the retention sweep's own read is
     * (CONVENTIONS.md section 6). An unscoped Prisma read would correctly return
     * NOTHING — RLS is FORCE'd on `service_records` and `app.practice_id` is
     * unset outside `withPractice` — so the platform's own cross-practice
     * question is asked through a function that returns IDS ONLY and is granted
     * to `aob_app` alone.
     */
    const rows = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
      SELECT * FROM core.post_service_chase_due(${cutoff}::timestamp, 50::int)`;
    return rows.map((r) => r.practiceId);
  }

  /** One practice's waiting services, each decided on its own and recorded. */
  async sweepPractice(practiceId: string): Promise<{ started: number; declined: number }> {
    const cutoff = new Date(Date.now() - PostServiceChaseSweep.DESK_GRACE_MS);
    const waiting = await this.prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findMany({
        where: {
          visitDecision: 'episodic_post',
          chaseStartedAt: null,
          serviceRenderedAt: { lte: cutoff },
        },
        orderBy: { serviceRenderedAt: 'asc' },
        take: 50,
      }),
    );

    let started = 0;
    let declined = 0;
    for (const record of waiting) {
      const outcome = await this.startCascadeFor(practiceId, record.id);
      if (outcome === 'started') started += 1;
      else declined += 1;
    }
    if (waiting.length > 0) {
      this.logger.log(
        `Post-service chase for ${practiceId}: ${started} cascade(s) started, ${declined} declined.`,
      );
    }
    return { started, declined };
  }

  /**
   * ONE WAITING SERVICE. Public so the named test can drive it without waiting
   * out an interval, and so a future "chase now" console act has one door.
   */
  async startCascadeFor(practiceId: string, serviceRecordId: string): Promise<'started' | 'declined'> {
    const context = await this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record || !record.agreementId || record.chaseStartedAt) return null;
      const agreement = await tx.agreement.findFirst({ where: { id: record.agreementId } });
      const patient = record.patientId ? await tx.patient.findFirst({ where: { id: record.patientId } }) : null;
      const practice = await tx.practice.findFirst({});
      return { record, agreement, patient, practiceName: practice?.name ?? 'your practice' };
    });
    if (!context || !context.agreement || !context.patient) return 'declined';
    const { record, agreement, patient } = context;

    /*
     * SOMEBODY SIGNED AFTER ALL. The commonest reason this sweep finds nothing
     * to do, and it is not a failure — it is the flow working. Marked so the
     * sweep does not look again.
     */
    if (agreement.signatureEventId) {
      await this.markStarted(practiceId, record.id, 'already_signed', null);
      return 'declined';
    }

    // REQ-CHASE-08 — never past the deadline.
    const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
    if (chaseBandFor(daysRemaining).band === 'expired') {
      await this.markStarted(practiceId, record.id, 'window_closed', null);
      return 'declined';
    }

    // REQ-CHASE-03 — no outbound contact of any kind for a flagged patient.
    if (patient.confidentialityFlag) {
      await this.markStarted(practiceId, record.id, 'confidentiality_flag', null);
      return 'declined';
    }

    // And we have to be able to reach them. A cascade with no channel is a
    // cascade that would only hide the item from the queue where a person
    // would otherwise see it.
    const channel = remoteChannelFor(patient);
    if (!channel) {
      await this.markStarted(practiceId, record.id, 'no_contact_channel', null);
      return 'declined';
    }

    /*
     * THE FIRST RUNG: a remote channel, and the message that carries it. The
     * same call `AutoCaptureService` makes for an invoice with nothing behind
     * it — one ladder, not a second one (REQ-CHASE-05's escalation column
     * alternates `ai` and `human` on the SAME ladder).
     */
    const opened = await this.capture.open(practiceId, { agreementId: agreement.id, channel });
    if (!opened.token) {
      this.logger.warn(`Post-service chase for service ${record.id}: a remote request opened with no token.`);
      return 'declined';
    }

    /*
     * WHO THE MESSAGE NAMES — through `anchorForAgreement`, the one definition of
     * "the practitioner at this location" (Carl, 7 Sep 2026). A second lookup
     * here would be a second chance to name somebody the agreement does not.
     */
    const token = opened.token;
    const providerName = await this.prisma.withPractice(practiceId, async (tx) => {
      const anchor = await anchorForAgreement(tx, agreement);
      return anchor?.name ?? 'your practitioner';
    });

    await this.prisma.withPractice(practiceId, (tx) =>
      this.links.sendPostAgreementLink(tx, {
        practiceId,
        practiceName: context.practiceName,
        patient,
        providerName,
        serviceDate: record.serviceDate,
        mbsItemNumbers: record.mbsItemNumbers,
        captureRequestId: opened.captureRequestId,
        channel,
        token,
        expiresAt: opened.expiresAt,
      }),
    );

    await this.markStarted(practiceId, record.id, 'nobody_signed_at_the_desk', channel, {
      agreementId: agreement.id,
      captureRequestId: opened.captureRequestId,
      daysRemaining,
      band: chaseBandFor(daysRemaining).band,
    });
    return 'started';
  }

  /**
   * THE CLOCK IS STOPPED, AND WHY IS RECORDED (hard rule 11: the row and its
   * event commit together, so a cascade with no record of having started — or a
   * record of one that did not — is structurally impossible).
   *
   * `chaseStartedAt` IS SET EVEN WHERE NOTHING WAS SENT. "We looked at half past
   * and decided not to contact this patient" is the fact, and a sweep that left
   * the column null would ask the same question every minute for a year. Why it
   * declined travels on the event, never as prose on the row.
   */
  private async markStarted(
    practiceId: string,
    serviceRecordId: string,
    reason: string,
    channel: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.serviceRecord.update({ where: { id: serviceRecordId }, data: { chaseStartedAt: new Date() } });
      await enqueueVaultEvent(tx, {
        type: 'service.chase_started',
        actor: SYSTEM_ACTOR,
        subject: { type: 'ServiceRecord', id: serviceRecordId },
        /*
         * A REASON CODE, A CHANNEL AND A BAND. No name, no number, no address,
         * no item number and no amount (REQ-LOG-08, hard rules 4 and 9). The
         * channel is the KIND of contact, never the destination.
         */
        payload: { practiceId, reason, channel: channel ?? '', ...extra },
      });
    });
  }
}
