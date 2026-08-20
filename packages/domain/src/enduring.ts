/**
 * Enduring agreement lifecycle rules (reg 65CA/65CB, REQ-END-*).
 *
 * The dangerous category is AUTOMATIC cessation (65CA(8)): these require no
 * notice from anybody and silently invalidate claims. An agreement relied on
 * after cessation produces a claim that was never validly assigned.
 */
import type { EnduringPathway } from './agreement';

/**
 * The six automatic cessation triggers (65CA(8), Addendum v2 §3.3).
 * `hospital_admission` is deliberately ABSENT and must stay absent: a
 * temporary hospital admission does NOT end an aged-care agreement
 * (65CA(9)), and a system that voids agreements on every hospital transfer
 * will be turned off by the first RACF that uses it.
 */
export const AUTOMATIC_CESSATION_TRIGGERS = [
  'mymedicare_deregistered',
  'practitioner_left_location',
  'left_residential_aged_care',
  'patient_turned_14',
  'left_accho_ams',
  'registration_anniversary_missed',
] as const;

export type AutomaticCessationTrigger = (typeof AUTOMATIC_CESSATION_TRIGGERS)[number];

export type CessationReason =
  | AutomaticCessationTrigger
  | 'patient_terminated'
  | 'assignor_terminated'
  | 'provider_terminated'
  | 'practitioner_deregistered'
  | 'scope_change_recreate';

/** Which pathways each automatic trigger can apply to. A trigger fired on the wrong pathway is a bug. */
export function triggerAppliesTo(trigger: AutomaticCessationTrigger, pathway: EnduringPathway): boolean {
  switch (trigger) {
    case 'mymedicare_deregistered':
      return pathway === 'mymedicare';
    case 'left_residential_aged_care':
      return pathway === 'residential_aged_care';
    case 'left_accho_ams':
      return pathway === 'accho_ams';
    case 'practitioner_left_location':
    case 'patient_turned_14':
    case 'registration_anniversary_missed':
      return true;
  }
}

/**
 * Reg 89AA notices are MyMedicare-only (REQ-END-05, C7.4). Never sent for
 * aged-care or ACCHO pathways — and never chased, since non-response has no
 * effect on payment (REQ-CHASE-02).
 */
export function requiresPostClaimNotice(pathway: EnduringPathway): boolean {
  return pathway === 'mymedicare';
}

// ---------------------------------------------------------------------------
// Termination timing — 2 BUSINESS days (REQ-END-06, REQ-OFF-03)
// ---------------------------------------------------------------------------

export const TERMINATION_BUSINESS_DAYS = 2;

/**
 * Public holidays are STATE-SPECIFIC and must be supplied by the caller: a
 * Friday notice before a long weekend lands differently in each state
 * (REQ-OFF-03). This function will not guess.
 *
 * ⚠ The holiday data source is a real, unbuilt dependency — data.gov.au
 * publishes an Australian public holidays dataset. Until it is wired in,
 * callers pass an empty set and the calculation is weekend-only, which is
 * WRONG NEAR EVERY PUBLIC HOLIDAY. Callers must record which holiday set
 * they used.
 */
export interface BusinessDayCalendar {
  /** ISO dates (YYYY-MM-DD) that are public holidays in the relevant state. */
  readonly publicHolidays: ReadonlySet<string>;
  /** The state whose calendar this is, recorded on the termination for audit. */
  readonly state: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isBusinessDay(date: Date, calendar: BusinessDayCalendar): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !calendar.publicHolidays.has(isoDate(date));
}

/**
 * The moment an enduring agreement ends: 2 business days after written
 * notice. Claims inside the window remain valid; claims after do not
 * (REQ-OFF-04).
 */
export function terminationEffectiveDate(
  noticeGiven: Date,
  calendar: BusinessDayCalendar,
  businessDays: number = TERMINATION_BUSINESS_DAYS,
): Date {
  const cursor = new Date(Date.UTC(noticeGiven.getUTCFullYear(), noticeGiven.getUTCMonth(), noticeGiven.getUTCDate()));
  let counted = 0;
  while (counted < businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor, calendar)) counted += 1;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// The anniversary fuse — 65CA(8)(e), REQ-END-03
// ---------------------------------------------------------------------------

/**
 * Agreements entered on or before 30 June 2027 CEASE unless registered with
 * Services Australia before their first anniversary. Nobody is tracking this;
 * the Department's own 40-page FAQ never mentions it (FAQ reconciliation
 * Part E). Decision D-11 remains open — no registration mechanism has been
 * published — so we track the fuse and warn, and build nothing speculative.
 */
export const ANNIVERSARY_FUSE_CUTOFF_DATE = '2027-06-30';
export const ANNIVERSARY_WARNING_DAYS = [90, 60, 30] as const;

export function hasAnniversaryFuse(enteredInto: string | Date): boolean {
  const entered = typeof enteredInto === 'string' ? enteredInto.slice(0, 10) : isoDate(enteredInto);
  return entered <= ANNIVERSARY_FUSE_CUTOFF_DATE;
}

export function anniversaryDate(enteredInto: Date): Date {
  const anniversary = new Date(enteredInto.getTime());
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  return anniversary;
}

export function daysUntilAnniversary(enteredInto: Date, now: Date = new Date()): number {
  return Math.ceil((anniversaryDate(enteredInto).getTime() - now.getTime()) / 86_400_000);
}

/** The warning band to surface, or null when none is due (REQ-END-03: 90/60/30). */
export function anniversaryWarningBand(enteredInto: Date, now: Date = new Date()): number | null {
  if (!hasAnniversaryFuse(enteredInto)) return null;
  const remaining = daysUntilAnniversary(enteredInto, now);
  if (remaining < 0) return null; // fuse already blown — a cessation, not a warning
  // TIGHTEST applicable band, not the widest: at 48 days remaining the
  // practice must see "60 days", not "90 days". Iterating the declared
  // 90/60/30 order and returning the first match reported the widest, which
  // would have understated every warning after the first.
  let band: number | null = null;
  for (const threshold of ANNIVERSARY_WARNING_DAYS) {
    if (remaining <= threshold) band = threshold;
  }
  return band;
}

// ---------------------------------------------------------------------------
// Age transition — the 14th birthday (65CA(8), REQ-CHILD-05, REQ-OFF-13)
// ---------------------------------------------------------------------------

export const SELF_ASSIGN_AGE = 14;
/** Prompt the practice this far ahead so it is re-papered before an invalid claim, not after. */
export const FOURTEENTH_BIRTHDAY_LEAD_DAYS = 30;

export function fourteenthBirthday(dateOfBirth: Date): Date {
  const birthday = new Date(dateOfBirth.getTime());
  birthday.setUTCFullYear(birthday.getUTCFullYear() + SELF_ASSIGN_AGE);
  return birthday;
}

/**
 * True when a patient covered under SOMEONE ELSE'S agreement is within the
 * lead window of turning 14. Deterministic from date of birth — there is no
 * excuse for missing it (Addendum v2 §3.3).
 */
export function needsFourteenthBirthdayAction(
  dateOfBirth: Date,
  assignorIsPatient: boolean,
  now: Date = new Date(),
): boolean {
  if (assignorIsPatient) return false;
  const days = Math.ceil((fourteenthBirthday(dateOfBirth).getTime() - now.getTime()) / 86_400_000);
  return days <= FOURTEENTH_BIRTHDAY_LEAD_DAYS;
}
