import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  KIOSK_CAPTURABLE_STATUSES,
  kioskPollMs,
  projectKioskWaitingRow,
  type KioskWaitingRow,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WHO IS HERE, FOR THIS PRACTICE, RIGHT NOW — the one question a tablet in a
 * waiting room asks, and the only gap left between the capture cascade and
 * the kiosk ceremony (CONSULTATION-CAPTURE-PLAN.md §2.2 step 1).
 *
 * Everything after this read already exists: the challenge
 * (`POST /verification/challenges`), the lock and render
 * (`POST /agreements/:id/particulars`), the signature
 * (`POST /agreements/:id/sign`) and the close
 * (`POST /capture/:id/complete`). This service adds no new ceremony; it
 * answers the list question and nothing else.
 *
 * A READ ACROSS TABLES, deliberately, on the precedent `ReconciliationService`
 * set: a screen that must show "Robin, 9:00, Dr Example" cannot be assembled
 * from one module's tables. It WRITES nothing and it owns nothing — no vault
 * event, no state change — so the module-boundary rule (no cross-module
 * *writes*, module APIs for behaviour) is not being bent to smuggle logic
 * somewhere it does not belong.
 *
 * IT NEVER BLOCKS CARE (REQ-REC-04). Nothing here gates a patient being seen:
 * a patient with no appointment row, no provider, or a PMS that is down still
 * appears on the list, and a failure of this endpoint costs a tablet its list,
 * not a person their appointment.
 */
@Injectable()
export class KioskService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The practice's `episodic_pre` drafts still waiting to be captured in
   * person, oldest appointment first.
   *
   * SCOPING IS THE DATABASE'S JOB. `withPractice` sets the transaction-local
   * `app.practice_id` and the FORCE RLS policies filter on it; a request
   * carrying another practice's id sees that practice and nothing of this
   * one, and a request carrying none sees zero rows rather than all of them.
   */
  async waitingList(practiceId: string): Promise<{
    practiceId: string;
    revision: string;
    pollMs: number;
    /** TYPES, never values (REQ-VER-04) — what the verify screen will ask for. */
    identifierTypes: string[];
    waiting: KioskWaitingRow[];
  }> {
    const rows = await this.prisma.withPractice(practiceId, async (tx) => {
      const requests = await tx.captureRequest.findMany({
        where: { channel: 'in_practice', status: 'open' },
        orderBy: { createdAt: 'asc' },
      });
      const practice = await tx.practice.findFirst({});
      if (requests.length === 0) {
        return { identifierTypes: practice?.identifierTypes ?? [], waiting: [] as KioskWaitingRow[] };
      }

      const agreements = await tx.agreement.findMany({
        where: {
          id: { in: requests.map((r) => r.agreementId) },
          type: 'episodic_pre',
          status: { in: [...KIOSK_CAPTURABLE_STATUSES] },
        },
      });
      const byAgreement = new Map(agreements.map((a) => [a.id, a]));

      const patients = await tx.patient.findMany({
        where: { id: { in: agreements.map((a) => a.patientId) } },
      });
      /*
       * A CONFIDENTIALITY FLAG KEEPS A NAME OFF THIS SCREEN (REQ-CHILD-01,
       * fail closed per REQ-CHILD-07). The cascade already declines to stage
       * a flagged patient, so this is the second fence rather than the first
       * — and it is the fence that still holds if a request is opened some
       * other way. The kiosk is a screen anyone in the room can read.
       */
      const patientById = new Map(patients.filter((p) => !p.confidentialityFlag).map((p) => [p.id, p]));

      const providerIds = agreements.map((a) => a.providerId).filter((id): id is string => Boolean(id));
      const providers = providerIds.length
        ? await tx.provider.findMany({ where: { id: { in: providerIds } } })
        : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));

      const appointments = await tx.appointment.findMany({
        where: { agreementId: { in: agreements.map((a) => a.id) } },
      });
      const appointmentByAgreement = new Map(
        appointments.filter((a) => a.agreementId).map((a) => [a.agreementId as string, a]),
      );

      const waiting: KioskWaitingRow[] = [];
      for (const request of requests) {
        const agreement = byAgreement.get(request.agreementId);
        if (!agreement) continue;
        const patient = patientById.get(agreement.patientId);
        if (!patient) continue;
        const provider = agreement.providerId ? providerById.get(agreement.providerId) : undefined;
        const appointment = appointmentByAgreement.get(agreement.id);

        /*
         * The projection is what keeps this honest: it is handed the patient
         * row and takes only the permitted fields, so a date of birth or an
         * IHI cannot reach the response even if somebody spreads the record
         * in here later.
         */
        waiting.push(
          projectKioskWaitingRow({
            ...patient,
            captureRequestId: request.id,
            agreementId: agreement.id,
            patientId: patient.id,
            patientName: `${patient.givenNames} ${patient.familyName}`,
            providerName: provider?.name ?? null,
            appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
            appointmentTime: appointment?.time ?? null,
            agreementStatus: agreement.status,
            waitingSince: request.createdAt.toISOString(),
          }),
        );
      }

      /*
       * BY APPOINTMENT TIME (§2.2 step 1). A walk-in has no time and belongs
       * at the end of the ordering, not at the top of it — they are already
       * the exception the critical lane carried in, and pushing them above a
       * booked patient who has been waiting since 8am would be the wrong
       * screen. Ties fall back to how long the request has been open.
       *
       * ORDINARY `<` COMPARISON, NOT `localeCompare`. ICU collation sorts
       * punctuation ahead of digits, so a sentinel string for "no time" ended
       * up at the TOP of the list — the opposite of what is written above,
       * and it took a failing test to see it. Times here are `HH:MM` from the
       * PMS, which sorts correctly as plain text.
       */
      waiting.sort((a, b) => {
        if (a.appointmentTime !== b.appointmentTime) {
          if (a.appointmentTime === null) return 1;
          if (b.appointmentTime === null) return -1;
          return a.appointmentTime < b.appointmentTime ? -1 : 1;
        }
        return a.waitingSince < b.waitingSince ? -1 : a.waitingSince > b.waitingSince ? 1 : 0;
      });

      return { identifierTypes: practice?.identifierTypes ?? [], waiting };
    });

    return {
      practiceId,
      revision: revisionOf(rows.waiting),
      pollMs: kioskPollMs(rows.waiting.length),
      identifierTypes: rows.identifierTypes,
      waiting: rows.waiting,
    };
  }
}

/**
 * THE CHANGE TOKEN, and why a tablet asking every two seconds is not rude.
 *
 * §9.4 settles the mechanism — a poll, not a push — and leaves the server the
 * job of making a two-second poll cheap. This is an ordinary HTTP ETag: the
 * fingerprint covers exactly what the screen renders, so an unchanged waiting
 * room answers `304 Not Modified` with no body, no JSON to parse and no
 * re-render. The query still runs (one indexed read on
 * `capture_requests`); what is saved is the payload and the client's work,
 * every second of a quiet morning.
 *
 * Status is part of the fingerprint, not just the set of ids: a patient
 * moving from `verification_pending` to `awaiting_signature` changes what the
 * row says and must change the token.
 */
function revisionOf(waiting: KioskWaitingRow[]): string {
  const material = waiting
    .map((row) => `${row.captureRequestId}:${row.agreementStatus}:${row.appointmentTime ?? ''}`)
    .join('|');
  return createHash('sha256').update(`${waiting.length}#${material}`).digest('hex').slice(0, 32);
}
