/**
 * Automatic capture — when the platform may ask a patient to sign WITHOUT a
 * person at the practice deciding first.
 *
 * Two triggers arrive from the PMS with nobody in the loop: an appointment
 * (so a pre-agreement can be ready when the patient reaches the desk) and an
 * invoice with no agreement behind it (so a post-agreement can be sent before
 * the twelve-month lodgement window closes). Both used to stop at "create one
 * yourself" — `ReconciliationService.resend` refuses an item with no
 * agreement because SOMEBODY HAS TO CHOOSE THE ASSIGNOR (D7). These rules say
 * when that choice is not a choice, and automation is therefore safe.
 *
 * Everything here is deliberately conservative: when in doubt the answer is
 * "suppress, record why, leave it for a person" — never "guess and send".
 */
import { MIN_AGE_SELF_ASSIGN } from './guards';

/** Whole years between a date of birth and a moment, calendar-accurate. */
export function ageYearsAt(dateOfBirth: Date, at: Date): number {
  let years = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (at.getUTCMonth() === dateOfBirth.getUTCMonth() && at.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
}

export type AutoAssignorDecision =
  | { readonly auto: true; readonly assignorIsPatient: true }
  | { readonly auto: false; readonly reason: 'under_self_assign_age' | 'dob_unknown' };

/**
 * May the patient be made their own assignor with nobody asking?
 *
 * Carl, 25 Aug 2026: "the self-assign age is 14 in Australia." That is
 * REQ-AGE-02 and `MIN_AGE_SELF_ASSIGN`, and this uses the constant so the
 * number lives in exactly one place. From 14 the patient IS the assignor by
 * default (D7 still recorded explicitly, never inferred — the caller writes
 * `assignorIsPatient: true`). Under 14, or with no date of birth to judge by,
 * a parent or guardian may need to sign, and choosing who is a human decision.
 */
export function autoAssignorDecision(input: {
  readonly dateOfBirth: Date | null | undefined;
  readonly at: Date;
}): AutoAssignorDecision {
  if (!input.dateOfBirth) return { auto: false, reason: 'dob_unknown' };
  return ageYearsAt(input.dateOfBirth, input.at) >= MIN_AGE_SELF_ASSIGN
    ? { auto: true, assignorIsPatient: true }
    : { auto: false, reason: 'under_self_assign_age' };
}

/**
 * Why the cascade decided not to ask. Recorded on a `capture.suppressed`
 * vault event every time, because "this patient was never asked" has to be
 * answerable, and a silence and a decision look the same in a table.
 */
export const AUTO_CAPTURE_SUPPRESSION_REASONS = [
  /** A live enduring agreement already covers this patient with this provider. */
  'enduring_covered',
  /** REQ-CHASE-03 — confidentiality-flagged patients get NO outbound contact. */
  'confidentiality_flag',
  /** REQ-CHASE-08 — the twelve-month lodgement window has closed; unbillable. */
  'window_closed',
  /** Under 14 or no DOB: a person must choose the assignor (D7). */
  'assignor_needs_human',
  /** No email and no mobile — a link nobody could receive. Left for staff. */
  'no_contact_channel',
  /** The PMS named a patient we could not mirror. */
  'patient_unresolved',
  /** The PMS named a provider we could not mirror. */
  'provider_unresolved',
] as const;

export type AutoCaptureSuppressionReason = (typeof AUTO_CAPTURE_SUPPRESSION_REASONS)[number];

/**
 * Which remote channel reaches this patient.
 *
 * Email first where both are held: it leaves the patient a copy they can
 * find again, and the message can carry the item numbers and the practice's
 * details in full. SMS is the fallback for the many patients a practice holds
 * only a mobile for. Neither — nothing is sent and nothing is drafted; a
 * draft nobody can act on would only hide the item from the reconciliation
 * queue where a person would otherwise see it.
 */
export function remoteChannelFor(patient: {
  readonly email?: string | null;
  readonly mobile?: string | null;
}): 'email_link' | 'sms_link' | null {
  if (patient.email?.trim()) return 'email_link';
  if (patient.mobile?.trim()) return 'sms_link';
  return null;
}
