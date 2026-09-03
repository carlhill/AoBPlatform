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

import type { AgreementStatus } from './agreement';

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
  'waitingSince',
] as const;

export type KioskWaitingRowField = (typeof KIOSK_WAITING_ROW_FIELDS)[number];

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
  /** ISO timestamp — when the request was opened, so the screen can show the oldest first. */
  waitingSince: string;
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
