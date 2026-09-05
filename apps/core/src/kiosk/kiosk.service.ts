import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  computeSignability,
  isServiceDescription,
  KIOSK_CAPTURABLE_STATUSES,
  kioskIdleTimeoutOrDefault,
  kioskPollMs,
  projectKioskWaitingRow,
  type ApprovedIdentifierType,
  type KioskCommand,
  type KioskScreen,
  type KioskWaitingRow,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService, type ResolvedDevice } from '../devices/devices.service';
import { evaluateChallenge, type PatientIdentityRecord } from '../verification/identifier-matching';
import {
  DEFAULT_IDENTIFIER_TYPES,
  GENERIC_MISMATCH_MESSAGE,
  VerificationService,
} from '../verification/verification.service';
import { ClaimAttemptLimit, CLAIM_ATTEMPT_LIMIT } from './claim-rate-limit';

/**
 * The one sentence a locked-out tablet shows, and it points at a person.
 * Identical in intent to the verification service's own lockout message: it
 * names no identifier, no patient and no reason, and it says the thing that
 * matters — reception can finish this.
 */
export const CLAIM_LOCKED_MESSAGE = 'Verification is locked. Please see our reception staff.';

/** What `POST /kiosk/claim` answers. The verify path's own shape, plus the row it found. */
export type KioskClaimResult =
  | { outcome: 'passed'; verificationEventId: string; row: KioskWaitingRow }
  | { outcome: 'failed' | 'locked_out'; message: string };

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
  /**
   * Shared across requests deliberately — a per-request limiter limits
   * nothing. Keyed by device id; see `claim-rate-limit.ts` for why that is the
   * only key a failed claim has.
   */
  private readonly claims = new ClaimAttemptLimit();

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    /**
     * REUSED THROUGH ITS MODULE API, NOT REIMPLEMENTED. Once a claim has found
     * its one row, the verification it records is the SAME call the old
     * list-then-verify flow made — challenge, attempt, event, vault event —
     * including the ADR A-08 read against PMS-held values. Copying twenty
     * lines of that into here would be a second, quietly diverging account of
     * how this practice verifies a patient.
     */
    private readonly verification: VerificationService,
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
    /**
     * A TEST DEVICE — the only kind shown the waiting list (Carl, 4 Sep 2026).
     *
     * IT IS ANSWERED HERE, ON THE FIRST CALL THE TABLET MAKES, so the idle
     * screen knows which front door Begin opens before anybody presses it.
     * Reading it off the poll instead would leave one render in which a
     * walk-up tablet believes it is a test device, and that render is a list
     * of patient names.
     *
     * It is a REPORT, not a setting: there is no endpoint a device credential
     * can reach that changes it (see `PATCH /devices/:id`).
     */
    showsWaitingList: boolean;
    /**
     * HOW LONG THIS TABLET WAITS BEFORE IT RETURNS TO THE START (Carl, 4 Sep
     * 2026). Seconds, from the practice.
     *
     * IT RIDES ON THE CALL THE TABLET ALREADY MAKES rather than on a settings
     * endpoint of its own, because a device with settings of its own is a
     * device somebody can configure at the tablet — and the whole point of
     * `/kiosk/me` is that the server answers who this device is and what it may
     * do. The tablet reads it on the same poll that already carries the build
     * floor, so a change reaches an open tab without re-pairing.
     *
     * NEVER ABSENT. The column is NOT NULL with a default, so an older tablet
     * reading a newer server gets a number, and a newer tablet reading an
     * older server falls back to the domain default rather than to no clock at
     * all (`kioskIdleTimeoutOrDefault`).
     */
    kioskIdleTimeoutSeconds: number;
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
      showsWaitingList: device.showsWaitingList,
      kioskIdleTimeoutSeconds: kioskIdleTimeoutOrDefault(practice?.kioskIdleTimeoutSeconds),
      kioskBuild,
      reload: await this.devices.shouldReload(device.practiceId, kioskBuild),
    };
  }

  /**
   * THE HEARTBEAT — where the tablet is, and what reception wants it to do
   * (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin").
   *
   * WHAT IT ANSWERS, AND WHY EACH PIECE IS HERE RATHER THAN SOMEWHERE ELSE:
   *
   *  - `command` — the pending "return to begin", served for two minutes and
   *    then dropped silently. It rides on the poll the tablet already makes
   *    because there is no other channel to a device that holds one opaque
   *    credential and nothing else; a socket would fail silently, and a
   *    silently dead reset is a tablet reception cannot get back.
   *  - `pollMs` — the SERVER'S cadence, not the device's choice, exactly as
   *    the waiting list has always worked. It matters more here: the waiting
   *    list poll is off mid-ceremony, so on those screens this is the only
   *    thing telling the tablet how often to ask, and a tablet picking its own
   *    number is a number nobody can change without a deploy.
   *  - `outOfUse` — reception has taken this tablet off the floor. The screen
   *    goes quiet and the tablet KEEPS HEARTBEATING, which is the whole
   *    difference from a revoke: it stays visible on the console and one press
   *    puts it back.
   *  - `reload` — the build floor, answered here for the same reason
   *    `/kiosk/me` answers it: this is now the one poll that runs on every
   *    screen, so it is the one place a rollback is guaranteed to reach.
   *
   * NO PATIENT DATA GOES IN OR COMES OUT. In: a screen NAME from a fixed list
   * and an opaque session id (the DTO refuses anything else, and the global
   * whitelist strips any fifth field). Out: a command id, a number and two
   * booleans (REQ-VER-04, hard rule 9).
   */
  async heartbeat(
    device: ResolvedDevice,
    input: {
      screen: KioskScreen;
      sessionId: string | null;
      build: string | null;
      ackCommandId: string | null;
    },
  ): Promise<{
    command: KioskCommand | null;
    pollMs: number;
    outOfUse: boolean;
    reload: boolean;
  }> {
    const [{ command, outOfUse }, waitingCount, reload] = await Promise.all([
      this.devices.recordHeartbeat(device, {
        screen: input.screen,
        sessionId: input.sessionId,
        kioskBuild: input.build,
        ackCommandId: input.ackCommandId,
      }),
      this.prisma.withPractice(device.practiceId, (tx) =>
        tx.captureRequest.count({ where: { channel: 'in_practice', status: 'open' } }),
      ),
      this.devices.shouldReload(device.practiceId, input.build),
    ]);

    /*
     * A COUNT, NEVER A LIST, AND IT NEVER LEAVES THIS FUNCTION. The cadence
     * derived from it is the only thing the tablet is told — how many people
     * are waiting is itself a disclosure, and it was the first one removed
     * from the ordinary tablet's waiting-list response (Carl, 4 Sep 2026).
     */
    return { command, pollMs: kioskPollMs(waitingCount), outOfUse, reload };
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
  private async collectWaiting(practiceId: string): Promise<{
    /** TYPES, never values (REQ-VER-04) — what the verify screen will ask for. */
    identifierTypes: string[];
    waiting: KioskWaitingRow[];
    /**
     * THE HELD VALUES, AND THEY NEVER LEAVE THIS SERVICE. `claim` compares
     * against them and drops them; nothing here is returned to a caller,
     * written to a log, or put in a vault payload (REQ-VER-04, hard rule 9).
     * The projected rows above are what a response is built from, and the
     * projection cannot carry one of these by accident.
     */
    identityByPatientId: Map<string, PatientIdentityRecord>;
  }> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const requests = await tx.captureRequest.findMany({
        where: { channel: 'in_practice', status: 'open' },
        orderBy: { createdAt: 'asc' },
      });
      const practice = await tx.practice.findFirst({});
      if (requests.length === 0) {
        return {
          identifierTypes: practice?.identifierTypes ?? [],
          waiting: [] as KioskWaitingRow[],
          identityByPatientId: new Map<string, PatientIdentityRecord>(),
        };
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
      /*
       * WHAT `claim` COMPARES AGAINST, built from exactly the rows the list is
       * built from. Same query, same confidentiality fence, same practice
       * scope: a patient the list would not show is a patient a claim cannot
       * find, which is the fail-closed direction (REQ-CHILD-01/-07 — the
       * ceremony would put that name on K-3 a moment later).
       */
      const identityByPatientId = new Map<string, PatientIdentityRecord>();
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
        identityByPatientId.set(patient.id, {
          familyName: patient.familyName,
          givenNames: patient.givenNames,
          dateOfBirth: patient.dateOfBirth,
          genderAsIdentified: patient.genderAsIdentified,
          address: patient.address,
          patientRecordNumber: patient.patientRecordNumber,
          ihi: patient.ihi,
        });

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

      return { identifierTypes: practice?.identifierTypes ?? [], waiting, identityByPatientId };
    });
  }


  /**
   * THE POLL — and, since 4 September 2026, it answers with NAMES only to a
   * device the console has flagged as a test device.
   *
   * WHY THE LIST WENT AWAY (Carl, 4 Sep 2026): "Remove the 'x people ready to
   * sign' text — this is a security feature. Then on the next page do not show
   * the list. … The list page is only for testing purposes." A tablet on a
   * counter is a screen anybody in the room can read, and a walk-up patient
   * has no business being shown who else is here. So the walk-up flow inverts:
   * the patient states their details and the SERVER finds their row
   * (`claim`, below), instead of the tablet showing rows and asking which one
   * they are.
   *
   * AND THERE IS NO COUNT. Not a smaller disclosure than the names — a
   * different one, and the one Carl named first. `hidden: true` is the whole
   * answer; the response carries no length to infer a count from.
   *
   * THE POLL ITSELF STAYS, because two things ride on it and neither is the
   * list: the forced reload after a rollback (`reload`, inside the ETag on
   * purpose — see `revisionOf`) and the tablet's own health signal, which is
   * simply whether this call answered. A hidden response is exactly the
   * lightweight heartbeat that job wants: no names, no count, one boolean, and
   * a 304 most of the time.
   *
   * `anyoneWaiting` IS A SECOND BOOLEAN, NOT A COUNT (Carl, 4 Sep 2026). The
   * idle screen needs to know whether Begin should be offered at all — a
   * tablet with nobody staged should say so rather than open a ceremony with
   * nothing to sign — and a boolean answers that without naming how many or
   * who. It is a far smaller disclosure than the count Carl removed: "someone
   * is here" carries nothing a bystander could not already see by looking
   * around the room.
   */
  async waitingList(
    device: ResolvedDevice,
    kioskBuild: string | null = null,
  ): Promise<{
    practiceId: string;
    revision: string;
    pollMs: number;
    /** TYPES, never values (REQ-VER-04) — what the verify screen will ask for. */
    identifierTypes: string[];
    waiting: KioskWaitingRow[];
    /** True when this device is not a test device: no rows, and no count either. */
    hidden: boolean;
    /**
     * TRUE IFF AT LEAST ONE OPEN IN-PRACTICE ROW EXISTS FOR THIS PRACTICE.
     * Present on every response, hidden or not — a caller reading this field
     * never has to branch on `hidden` first. On a visible (test) response it
     * is redundant with `waiting.length > 0`; it exists there too only so the
     * shape is the one shape.
     */
    anyoneWaiting: boolean;
    /** The tablet is below this practice's build floor and must reload. */
    reload: boolean;
  }> {
    const { practiceId } = device;
    const reload = await this.devices.shouldReload(practiceId, kioskBuild);

    if (!device.showsWaitingList) {
      /*
       * STILL NOT A FILTERED LIST. No row is fetched, no name is read, and
       * nothing here can be projected into a `KioskWaitingRow`. The one query
       * this branch now runs is an EXISTENCE check — "is there at least one"
       * — capped at a single row and read for its presence, never its
       * content. A disclosure that depends on a caller remembering to filter
       * is a disclosure waiting for the next caller; this one has nothing to
       * filter because it never selects a name, a time or a status.
       */
      const { identifierTypes, anyoneWaiting } = await this.prisma.withPractice(practiceId, async (tx) => {
        const practice = await tx.practice.findFirst({});
        const openRow = await tx.captureRequest.findFirst({
          where: { channel: 'in_practice', status: 'open' },
          select: { id: true },
        });
        return { identifierTypes: practice?.identifierTypes ?? [], anyoneWaiting: openRow !== null };
      });
      return {
        practiceId,
        revision: revisionOf([], reload, true, anyoneWaiting),
        // Faster while somebody is staged — the same cadence a visible
        // tablet gets — so Begin appears within one poll of somebody being
        // ready rather than waiting out the idle cadence first.
        pollMs: kioskPollMs(anyoneWaiting ? 1 : 0),
        identifierTypes,
        waiting: [],
        hidden: true,
        anyoneWaiting,
        reload,
      };
    }

    const rows = await this.collectWaiting(practiceId);
    const anyoneWaiting = rows.waiting.length > 0;
    return {
      practiceId,
      revision: revisionOf(rows.waiting, reload, false, anyoneWaiting),
      pollMs: kioskPollMs(rows.waiting.length),
      identifierTypes: rows.identifierTypes,
      waiting: rows.waiting,
      hidden: false,
      anyoneWaiting,
      reload,
    };
  }

  /**
   * THE WALK-UP FRONT DOOR (Carl, 4 Sep 2026): the patient states three
   * details and the server finds the ONE waiting row of this practice that
   * matches all of them — and verifies them in the same step.
   *
   * IT REPLACES "TAP YOUR NAME, THEN PROVE IT". That flow put a list of
   * patient names on a screen in a waiting room, which is a disclosure to
   * everyone in the room and not only to the person at the tablet. Turning it
   * around costs the patient nothing — they were going to type these three
   * details anyway — and costs a bystander everything.
   *
   * EVERY ROW IS EVALUATED. No early exit on the first match and none on the
   * first miss: how far down the list a guess got must not be readable from
   * how long the answer took, and the ambiguity check needs the full count
   * anyway. `evaluateChallenge` is the same comparator the remote link uses,
   * so "Jamie Sampleton" / "Sampleton Jamie" and "2 Example St" / "2 Example
   * Street" behave here exactly as they behave there.
   *
   * ZERO AND MANY ARE THE SAME ANSWER, and that is the load-bearing sentence.
   * "No such patient", "that patient is not waiting today" and "two people
   * here match what you typed" are three different facts about other people,
   * and a walk-up tablet may disclose none of them. All three return the one
   * generic refusal the verification service already owns, all three spend an
   * attempt, and all three point at reception.
   *
   * THE MATCH IS FOUND ON OUR MIRROR; THE VERIFICATION IS THE REAL ONE. The
   * fan-out compares against the same rows the waiting list is built from —
   * one query, not a per-row PMS call for a room full of people. Once exactly
   * one row matches, the actual verification goes through
   * `VerificationService.startChallenge` + `attempt`, which is the ordinary
   * in-practice path: it re-reads the patient from the PMS where the adapter
   * allows (ADR A-08), records TYPES and an outcome and never a value
   * (REQ-VER-04), and writes its own vault event. A patient who matches our
   * mirror but not the PMS gets the same generic refusal as anybody else.
   *
   * IT NEVER BLOCKS CARE (hard rule 8). Every refusal here ends at reception
   * with the appointment untouched; nothing on this path can stop a patient
   * being seen or billed.
   */
  async claim(device: ResolvedDevice, stated: Record<string, string>): Promise<KioskClaimResult> {
    const { practiceId, deviceId } = device;

    if (this.claims.isLockedOut(deviceId)) {
      return { outcome: 'locked_out', message: CLAIM_LOCKED_MESSAGE };
    }

    const { identifierTypes, waiting, identityByPatientId } = await this.collectWaiting(practiceId);
    const types = (identifierTypes.length > 0
      ? identifierTypes
      : [...DEFAULT_IDENTIFIER_TYPES]) as ApprovedIdentifierType[];

    let matched: KioskWaitingRow | null = null;
    let matchCount = 0;
    for (const row of waiting) {
      const identity = identityByPatientId.get(row.patientId);
      // Every row, always — see the note above on why there is no early exit.
      const hit = identity ? evaluateChallenge(types, stated, identity) : false;
      if (hit) {
        matchCount += 1;
        matched = row;
      }
    }

    if (matchCount !== 1 || !matched) {
      return this.claimFailed(practiceId, deviceId, types, { matchCount, candidateCount: waiting.length });
    }

    /*
     * THE ORDINARY IN-PRACTICE VERIFICATION, ON THE ROW WE FOUND. A challenge
     * and one attempt, exactly as the old flow made them once the patient had
     * tapped their name — so what lands in `verification_challenges` and
     * `verification_events` is indistinguishable from what landed there
     * before, and an auditor in 2028 reads one story rather than two.
     */
    const challenge = await this.verification.startChallenge(practiceId, {
      patientId: matched.patientId,
      channel: 'in_practice',
      identifierTypes: types,
    });
    const result = await this.verification.attempt(practiceId, challenge.challengeId, { stated });
    if (result.outcome !== 'passed' || !result.verificationEventId) {
      // The mirror said yes and the PMS said no (ADR A-08). Same refusal: the
      // patient learns nothing about why, and neither does anybody else.
      return this.claimFailed(practiceId, deviceId, types, { matchCount, candidateCount: waiting.length });
    }

    this.claims.clear(deviceId);
    const verificationEventId = result.verificationEventId;
    const row = matched;

    await this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * THE AGREEMENT POINTS AT THE EVENT THAT VERIFIED IT, which is what
       * REQ-SIG-02 binds into the signature later. This is the same write
       * `CaptureService.verifyLink` makes on the remote path, made here for
       * the same reason it is made there: the alternative is a signed
       * agreement whose evidence chain has no link to the check that preceded
       * it. The STATUS transition is deliberately NOT made here — the tablet's
       * existing `POST /agreements/:id/transition` still owns it, through the
       * domain transition map that refuses anything the lifecycle does not
       * allow.
       */
      await tx.agreement.update({
        where: { id: row.agreementId },
        data: { verificationEventId },
      });
      await enqueueVaultEvent(tx, {
        type: 'kiosk.claim_matched',
        // The DEVICE did this. Nobody signed in at a tablet, and attributing
        // it to a staff member would be a fabricated attribution.
        actor: { principalType: 'device', id: deviceId },
        subject: { type: 'VerificationEvent', id: verificationEventId },
        payload: {
          outcome: 'passed',
          channel: 'in_practice',
          // TYPES, not values, and sorted so two identical checks compare
          // equal whatever order a caller listed them in (REQ-VER-04).
          identifierTypes: [...types].sort().join(','),
          identifierTypeCount: types.length,
          // The device fingerprint the walk-up path has instead of a staff
          // identity: which tablet, and nothing about who was holding it.
          deviceId,
          candidateCount: waiting.length,
        },
      });
    });

    return { outcome: 'passed', verificationEventId, row };
  }

  /**
   * ONE REFUSAL FOR EVERY WAY A CLAIM CAN FAIL — nobody matched, several
   * matched, or the PMS disagreed with our mirror. The caller is told "some of
   * those details do not match" and nothing else; the vault is told the shape
   * of what happened, because the vault is evidence and the tablet is a
   * waiting room.
   */
  private async claimFailed(
    practiceId: string,
    deviceId: string,
    types: readonly ApprovedIdentifierType[],
    counts: { matchCount: number; candidateCount: number },
  ): Promise<KioskClaimResult> {
    this.claims.recordFailure(deviceId);
    const lockedOut = this.claims.isLockedOut(deviceId);

    await this.prisma.withPractice(practiceId, async (tx) => {
      await enqueueVaultEvent(tx, {
        type: lockedOut ? 'kiosk.claim_locked_out' : 'kiosk.claim_failed',
        actor: { principalType: 'device', id: deviceId },
        /*
         * THE SUBJECT IS THE DEVICE, NECESSARILY. A failed claim identified
         * nobody, so there is no patient and no verification event to hang it
         * on — and inventing one would be the fabrication this whole product
         * exists to prevent.
         */
        subject: { type: 'Device', id: deviceId },
        payload: {
          outcome: lockedOut ? 'locked_out' : 'failed',
          channel: 'in_practice',
          identifierTypeCount: types.length,
          deviceId,
          // How many rows matched: zero, or several. The distinction the
          // tablet must never make is safe here, and it is the one fact that
          // makes an ambiguous waiting room investigable later.
          matchCount: counts.matchCount,
          candidateCount: counts.candidateCount,
          attemptsAllowed: CLAIM_ATTEMPT_LIMIT,
        },
      });
    });

    return lockedOut
      ? { outcome: 'locked_out', message: CLAIM_LOCKED_MESSAGE }
      : { outcome: 'failed', message: GENERIC_MISMATCH_MESSAGE };
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
 *
 * AND SO IS `anyoneWaiting`, for the identical reason on a hidden tablet. It
 * is the ONLY thing that can change on a walk-up tablet's poll — no rows, no
 * count, nothing else material — so leaving it out of the fingerprint would
 * mean a quiet morning's Begin never appearing: the first patient to be
 * staged would answer 304 forever, on a token computed before they arrived.
 */
function revisionOf(waiting: KioskWaitingRow[], reload: boolean, hidden: boolean, anyoneWaiting: boolean): string {
  const material = waiting
    .map(
      (row) =>
        `${row.captureRequestId}:${row.agreementStatus}:${row.appointmentTime ?? ''}:` +
        `${row.signable}:${row.blockedReason ?? ''}`,
    )
    .join('|');
  return createHash('sha256')
    .update(`${waiting.length}#${material}#reload:${reload}#hidden:${hidden}#anyoneWaiting:${anyoneWaiting}`)
    .digest('hex')
    .slice(0, 32);
}
