import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  computeSignability,
  isServiceDescription,
  KIOSK_CAPTURABLE_STATUSES,
  kioskPollMs,
  projectKioskWaitingRow,
  type KioskWaitingRow,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService, type ResolvedDevice } from '../devices/devices.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /**
   * WHO THIS TABLET IS. The practice name and state for the header, the label
   * somebody gave the device, and whether it is below the practice's kiosk
   * build floor.
   *
   * IT REPLACES THE ENV-VAR PRACTICE ID. The tablet used to be told which
   * practice it belonged to at build time and to fetch that practice by id;
   * now it holds one opaque credential and asks. Nothing configurable comes
   * back — a device with no settings is a device that cannot be configured to
   * ask for a Medicare card number (REQ-VER-02).
   *
   * NO PATIENT DATA, and nothing about the practice beyond what a waiting-room
   * header shows: a name and a state.
   */
  async me(
    device: ResolvedDevice,
    kioskBuild: string | null,
  ): Promise<{
    deviceId: string;
    deviceLabel: string;
    practiceId: string;
    practiceName: string;
    state: string | null;
    /** TYPES, never values (REQ-VER-04) — what the verify screen will ask for. */
    identifierTypes: string[];
    kioskBuild: string | null;
    reload: boolean;
  }> {
    const practice = await this.prisma.withPractice(device.practiceId, (tx) => tx.practice.findFirst({}));
    return {
      deviceId: device.deviceId,
      deviceLabel: device.label,
      practiceId: device.practiceId,
      practiceName: practice?.name ?? '',
      state: practice?.state ?? null,
      identifierTypes: practice?.identifierTypes ?? [],
      kioskBuild,
      reload: await this.devices.shouldReload(device.practiceId, kioskBuild),
    };
  }

  /**
   * The practice's `episodic_pre` drafts still waiting to be captured in
   * person, oldest appointment first.
   *
   * SCOPING IS THE DATABASE'S JOB. `withPractice` sets the transaction-local
   * `app.practice_id` and the FORCE RLS policies filter on it; a request
   * carrying another practice's id sees that practice and nothing of this
   * one, and a request carrying none sees zero rows rather than all of them.
   */
  async waitingList(
    practiceId: string,
    kioskBuild: string | null = null,
  ): Promise<{
    practiceId: string;
    revision: string;
    pollMs: number;
    /** TYPES, never values (REQ-VER-04) — what the verify screen will ask for. */
    identifierTypes: string[];
    waiting: KioskWaitingRow[];
    /** The tablet is below this practice's build floor and must reload. */
    reload: boolean;
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
         * SIGNABLE, CHECKED BEFORE THE PATIENT DOES ANYTHING (TODO.md, "Two
         * rulings from pairing day", 4 Sep 2026). Carl chose a name, passed
         * all three identifiers, and only then reached a hand-over screen
         * that named nobody — the patient's effort spent for nothing, and
         * reception with no way to tell who needed fixing. `computeSignability`
         * is the same D6a read `lockParticulars` does
         * (`dto.basicServiceDescription ?? agreement.serviceDescription`,
         * here without a DTO to prefer), matched against the identical
         * `isServiceDescription` list `GET /service-descriptions` serves —
         * cheap and structural, not a rules-engine call per row per poll. K-3's
         * full validation at lock time is still the last line of defence.
         */
        const particulars = agreement.particulars as Record<string, unknown> | null;
        const basicServiceDescription =
          agreement.serviceDescription ??
          (typeof particulars?.basicServiceDescription === 'string'
            ? (particulars.basicServiceDescription as string)
            : undefined);
        const signability = computeSignability(
          { particularsLockedAt: agreement.particularsLockedAt, basicServiceDescription },
          isServiceDescription,
        );

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
            agreementType: agreement.type,
            waitingSince: request.createdAt.toISOString(),
            signable: signability.signable,
            blockedReason: signability.signable ? null : signability.blockedReason,
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

    const reload = await this.devices.shouldReload(practiceId, kioskBuild);
    return {
      practiceId,
      revision: revisionOf(rows.waiting, reload),
      pollMs: kioskPollMs(rows.waiting.length),
      identifierTypes: rows.identifierTypes,
      waiting: rows.waiting,
      reload,
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
 * row says and must change the token. `signable`/`blockedReason` too — the
 * whole point of computing them per row is that reception setting a Basic
 * Service Description while a practice-staff member is fixing it must reach
 * a tablet the patient is standing at, not wait behind a 304.
 *
 * AND SO IS THE RELOAD FLAG, for a reason that only shows up on a quiet
 * morning. A practice rolling its kiosk build back changes nothing about who
 * is waiting; if `reload` sat outside the fingerprint, every poll would answer
 * 304 with no body and the rollback would never reach the tab it was issued
 * for — the exact failure the forced reload exists to prevent.
 */
function revisionOf(waiting: KioskWaitingRow[], reload: boolean): string {
  const material = waiting
    .map(
      (row) =>
        `${row.captureRequestId}:${row.agreementStatus}:${row.appointmentTime ?? ''}:` +
        `${row.signable}:${row.blockedReason ?? ''}`,
    )
    .join('|');
  return createHash('sha256')
    .update(`${waiting.length}#${material}#reload:${reload}`)
    .digest('hex')
    .slice(0, 32);
}
