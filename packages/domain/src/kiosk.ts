/**
 * The waiting-room tablet — CONSULTATION-CAPTURE-PLAN.md §2.2 and §9.4.
 *
 * WHAT THE KIOSK IS. A staff passkey session in a big-buttons layout (Part 6,
 * decision 3: no device credential). It is therefore scoped to one practice by
 * the signed-in staff session, exactly like every other practice surface, and
 * the server half is an ordinary practice-scoped read.
 *
 * WHAT IT MAY SHOW, and this is the part that is encoded rather than
 * described. A list needs a name, a provider and a time. It does not need a
 * date of birth, an address, a patient record number, an IHI or a gender —
 * and a screen standing in a waiting room is the last place any of those
 * should appear. `projectKioskWaitingRow` builds a row by PICKING the
 * permitted fields out of whatever it is handed, so a caller passing a whole
 * patient record cannot leak one by accident: the extra fields are dropped by
 * construction, not by a reviewer noticing (REQ-VER-04, hard rule 9).
 *
 * The name is the one approved identifier that does appear, because a list of
 * people that names nobody cannot be used to pick the person at the desk —
 * and the plan's own device payload (2.1, phase 4) already carries it.
 */

import type { AgreementStatus, AgreementType } from './agreement';

/**
 * The statuses a pre-agreement can be in while it is still waiting for the
 * ceremony. Signed and beyond have left the list; declined and expired never
 * come back to it.
 */
export const KIOSK_CAPTURABLE_STATUSES = [
  'draft',
  'verification_pending',
  'verification_failed',
  'awaiting_signature',
] as const satisfies readonly AgreementStatus[];

export type KioskCapturableStatus = (typeof KIOSK_CAPTURABLE_STATUSES)[number];

export function isKioskCapturableStatus(status: string): status is KioskCapturableStatus {
  return (KIOSK_CAPTURABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Every field a waiting-list row may carry. The list is the contract: adding
 * to it is a deliberate act with this comment attached, which is the point.
 */
export const KIOSK_WAITING_ROW_FIELDS = [
  'captureRequestId',
  'agreementId',
  /** An opaque id, not an identifier value — the kiosk needs it to open the verification challenge. */
  'patientId',
  'patientName',
  'providerName',
  'appointmentDate',
  'appointmentTime',
  'agreementStatus',
  'agreementType',
  'waitingSince',
  'signable',
  'blockedReason',
] as const;

export type KioskWaitingRowField = (typeof KIOSK_WAITING_ROW_FIELDS)[number];

/**
 * A CODE, NEVER FREE TEXT — and never a rule message with data folded into it
 * (hard rule 9's reasoning applied to a new surface: this screen is read by
 * whoever is in the waiting room, so it must say "signable or not" without
 * ever repeating a rules-engine sentence that might, some day, carry a detail
 * it should not). `apps/web` maps each code to its own string-table entry;
 * `'other'` is the fallback for a structural block this precheck did not
 * anticipate, so an unrecognised reason still renders as "please see
 * reception" rather than nothing at all.
 */
export type KioskBlockedReason = 'service_description_missing' | 'particulars_incomplete' | 'other';

export interface KioskWaitingRow {
  captureRequestId: string;
  agreementId: string;
  patientId: string;
  patientName: string;
  providerName: string | null;
  /** ISO date (yyyy-mm-dd) of the appointment, or null for a walk-in with no booking. */
  appointmentDate: string | null;
  appointmentTime: string | null;
  agreementStatus: KioskCapturableStatus;
  /**
   * Which of the four agreement types this row is (`packages/domain/src/agreement.ts`).
   * Every kiosk row is `episodic_pre` today — enduring at the kiosk is not
   * built (README.md, "Not built here") — but the field is carried so K-3 can
   * pick its type-specific heading ("Agree to bulk billing for today's
   * visit" vs the enduring wording) without a second call (TODO.md, "Two
   * rulings from pairing day", 4 Sep 2026 copy follow-up).
   */
  agreementType: AgreementType;
  /** ISO timestamp — when the request was opened, so the screen can show the oldest first. */
  waitingSince: string;
  /**
   * CAN THIS AGREEMENT BE SIGNED RIGHT NOW — asked and answered BEFORE the
   * patient does anything (TODO.md, "Two rulings from pairing day", 4 Sep
   * 2026). Carl tapped a name, passed all three identifiers, and only then
   * discovered the agreement had no Basic Service Description — the patient's
   * time spent for nothing, and the hand-over that followed named nobody, so
   * reception had no idea who to fix. `computeSignability` answers this from
   * the agreement alone, cheaply, on every poll; K-3's full rules-engine
   * validation at lock time remains the last line of defence and is not
   * replaced by this precheck.
   */
  signable: boolean;
  /** Set only when `signable` is false. See `KioskBlockedReason`. */
  blockedReason: KioskBlockedReason | null;
}

/**
 * THE CHEAP, STRUCTURAL PRECHECK BEHIND `signable` — deliberately not a call
 * to the rules engine. The rules service (`apps/rules`) is the only authority
 * on whether a payload passes s 65C, and asking it once per row on every
 * two-second poll would multiply a waiting room's traffic by its headcount for
 * no reason: the one particular this list can usefully check without it is
 * the one the kiosk itself cannot supply (D6a — see `README.md`'s "What K-3
 * does when the rules engine refuses").
 *
 * ALREADY LOCKED MEANS ALREADY SIGNABLE. `particularsLockedAt` being set means
 * the rules engine has already accepted this agreement's particulars once
 * (REQ-REG-06) — re-litigating that here would be a second, weaker copy of a
 * check the lock already made honestly.
 *
 * `isValidServiceDescription` IS INJECTED rather than imported from
 * `./service-descriptions` here, so this stays a pure function over plain
 * data — easy to unit test, and the same function core and any future caller
 * can share without agreeing on where the content file lives.
 */
export function computeSignability(
  agreement: {
    readonly particularsLockedAt: string | Date | null;
    /** `agreement.serviceDescription ?? particulars.basicServiceDescription` — the same read `lockParticulars` does. */
    readonly basicServiceDescription: string | null | undefined;
  },
  isValidServiceDescription: (value: string) => boolean,
): { readonly signable: true } | { readonly signable: false; readonly blockedReason: KioskBlockedReason } {
  if (agreement.particularsLockedAt) return { signable: true };

  const d6a = agreement.basicServiceDescription;
  if (!d6a || !isValidServiceDescription(d6a)) {
    return { signable: false, blockedReason: 'service_description_missing' };
  }
  return { signable: true };
}

/**
 * Build a row by taking ONLY the permitted fields. Anything else on the
 * source object — dateOfBirth, address, ihi, patientRecordNumber, mobile,
 * email — is dropped here and never reaches a response.
 */
export function projectKioskWaitingRow(source: Record<string, unknown>): KioskWaitingRow {
  const row: Record<string, unknown> = {};
  for (const field of KIOSK_WAITING_ROW_FIELDS) row[field] = source[field] ?? null;
  return row as unknown as KioskWaitingRow;
}

/**
 * HOW FAST THE TABLET ASKS AGAIN — §9.4, and the reasoning there is the
 * reasoning here.
 *
 * `useLiveRefresh` argues for polling over push and is right about it: a dead
 * socket fails silently, a poll fails visibly. It also says the console's
 * conditions are "minutes or hours, a handful of times a week" — and the
 * kiosk is precisely the case where those conditions fail. So: the same hook,
 * a much shorter interval, and only while an arrival is expected.
 *
 * TWO CADENCES, because "only while an arrival is expected" has to mean
 * something at the server end too:
 *
 *   - `waitingMs` (2 s) whenever somebody is on the list. The plan's band is
 *     1–2 seconds; the upper end is the polite one and still lands the p95
 *     under five seconds — the critical inbound worker's hop is one second
 *     (LANE_POLICIES.critical.pollMs) and this is the second hop.
 *   - `idleMs` (15 s) when the list is empty. NOT zero: a walk-in nobody
 *     booked is exactly the case the critical lane exists for, and a tablet
 *     that stopped asking would never show them. Fifteen seconds is the
 *     console's ordinary cadence (LIVE_REFRESH_MS), which is what an empty
 *     waiting room deserves.
 *
 * The server returns the cadence rather than the device choosing it, so the
 * interval can be changed in one place for every tablet in the country.
 */
export const KIOSK_POLL_MS = {
  waitingMs: 2_000,
  idleMs: 15_000,
} as const;

export function kioskPollMs(waitingCount: number): number {
  return waitingCount > 0 ? KIOSK_POLL_MS.waitingMs : KIOSK_POLL_MS.idleMs;
}

/**
 * RETURN TO THE START WHEN NOBODY IS THERE (Carl, 4 September 2026).
 *
 * A patient is called in mid-ceremony, or simply walks off. The tablet is then
 * sitting on a counter in a waiting room with somebody's name, date of birth
 * and address on it, and the next person to pick it up is a stranger. So every
 * screen but the idle one is on a clock: any pointer, touch or key activity
 * resets it, and on expiry the tablet drops EVERYTHING it holds in memory and
 * returns to idle.
 *
 * IT IS A PER-PRACTICE SETTING, NOT A CONSTANT, and the constants here are the
 * default and the bounds around it. A busy practice with a tablet at the desk
 * wants it short; a quiet one handing a tablet to somebody reading slowly wants
 * it longer, and neither of them should have to ring us. Five minutes is the
 * default because it is long enough to read an agreement standing up and short
 * enough that a walked-away patient's details are gone before the next person
 * reaches the counter.
 *
 * THE BOUNDS ARE ENFORCED IN THE DTO AND HERE, not merely rendered as `min`
 * and `max` on an input. A minute is the floor because anything shorter resets
 * the screen while somebody is still reading it — which would BLOCK CARE by
 * making the ceremony uncompletable (hard rule 8, REQ-REC-04) — and thirty
 * minutes is the ceiling because a tablet holding particulars for longer than
 * a consultation is no longer "between patients", it is left out.
 */
export const KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS = 300;
export const KIOSK_IDLE_TIMEOUT_MIN_SECONDS = 60;
export const KIOSK_IDLE_TIMEOUT_MAX_SECONDS = 1_800;

/**
 * THE QUIET WARNING BEFORE IT HAPPENS. Thirty seconds, on every screen the
 * clock covers, and tapping anywhere cancels it — because the one thing worse
 * than a tablet that resets is a tablet that resets under the hand of somebody
 * who was still reading.
 */
export const KIOSK_IDLE_WARNING_SECONDS = 30;

export function isKioskIdleTimeoutInRange(seconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= KIOSK_IDLE_TIMEOUT_MIN_SECONDS &&
    seconds <= KIOSK_IDLE_TIMEOUT_MAX_SECONDS
  );
}

/**
 * WHAT THE TABLET USES when the server said nothing it can believe.
 *
 * An older core that does not carry the field, a failed identity read, a value
 * outside the bounds: all three answer the default rather than "no timeout".
 * FAIL CLOSED — the failure mode of an absent setting must be a screen that
 * clears itself, never one that holds a patient's address until somebody
 * notices.
 */
export function kioskIdleTimeoutOrDefault(seconds: unknown): number {
  return typeof seconds === 'number' && isKioskIdleTimeoutInRange(seconds)
    ? seconds
    : KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS;
}
