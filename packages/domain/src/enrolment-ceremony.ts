/**
 * REQ-PKI-01 — the practitioner enrolment ceremony.
 *
 * "The key is only as good as the ceremony that bound it. A key issued to
 * whoever answered the email proves nothing." (Addendum v5, PART C.)
 *
 * A passkey is a STRONG credential: everything it signs lands in the vault
 * attributed to a named practitioner, tamper-evidently and permanently. Bind
 * a strong credential through a weak ceremony and the result is worse than no
 * credential — confident, durable, cryptographically-attested attribution to
 * a person nobody verified. This module is the gate that stops that.
 *
 * Three checks, all BEFORE a key is bound:
 *   1. current AHPRA registration
 *   2. the provider number, and its location
 *   3. the person, by video or in person
 *
 * What this does NOT buy (PART C4): a practitioner who is themselves the
 * fraudster will happily sign. It defeats IMPERSONATION, not INTENT — it
 * removes the "someone must have used my provider number" defence, which is
 * why it pairs with anomaly detection rather than replacing it.
 */

/** Only these prove a person. An emailed link and a phone call do not. */
export const PERSON_VERIFICATION_METHODS = ['video', 'in_person'] as const;
export type PersonVerificationMethod = (typeof PERSON_VERIFICATION_METHODS)[number];

/**
 * ⚠ DRAFT PARAMETER pending Carl's decision (like the C2 tolerance).
 *
 * A ceremony is a point-in-time verification. Binding a key today on checks
 * done eighteen months ago is not a ceremony, it is a memory — the
 * practitioner may have been deregistered since. REQ-PKI-04 requires AHPRA
 * status be checked "on every high-risk action", and binding a key is one, so
 * a stale ceremony must not gate a binding.
 */
export const CEREMONY_FRESHNESS_DAYS = 30;

/**
 * AHPRA registration numbers are three profession letters followed by ten
 * digits (e.g. MED0001234567). FR-1.11 asks for FORMAT validation only —
 * existence is checked manually at onboarding, automated re-verification is
 * roadmap.
 *
 * Deliberately NOT a prefix whitelist: an incomplete list would REJECT
 * legitimate practitioners, which is the worse failure direction. Shape only.
 */
export const AHPRA_NUMBER_PATTERN = /^[A-Z]{3}\d{10}$/;

export function isValidAhpraNumberFormat(value: string): boolean {
  return AHPRA_NUMBER_PATTERN.test(value.trim().toUpperCase());
}

export class CeremonyError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'CeremonyError';
  }
}

export interface CeremonyRecord {
  /** Check 1 — current AHPRA registration. */
  readonly ahpraNumber: string;
  readonly ahpraRegistrationCurrent: boolean;
  /** Check 2 — the provider number AND the place of practice it is valid for. */
  readonly providerNumber: string;
  readonly providerNumberLocation: string;
  readonly providerNumberVerified: boolean;
  /** Check 3 — the person. */
  readonly personVerificationMethod: PersonVerificationMethod;
  /** The named human who performed the checks. Never "system". */
  readonly verifiedByName: string;
  /** Their platform identity, where they have one — self-attestation is blocked on this. */
  readonly verifiedByStaffId?: string;
  readonly evidenceNote?: string;
  readonly performedAt: Date;
  /** REQ-PKI-05 — a re-enrolment ceremony must be explicitly stepped up. */
  readonly steppedUp?: boolean;
}

export interface CeremonyContext {
  /** True when this provider already has a key bound — i.e. this is RECOVERY. */
  readonly isReEnrolment: boolean;
  /** The provider's own platform identity, to block self-attestation. */
  readonly providerStaffId?: string;
  readonly now?: Date;
  readonly freshnessDays?: number;
}

/**
 * The gate. Throws unless all three checks are affirmative, the ceremony is
 * fresh, a named human other than the subject performed it, and — for
 * re-enrolment — it was explicitly stepped up.
 */
export function assertCeremonySufficient(record: CeremonyRecord, context: CeremonyContext): void {
  const now = context.now ?? new Date();
  const freshnessDays = context.freshnessDays ?? CEREMONY_FRESHNESS_DAYS;

  // Check 1 — AHPRA.
  if (!isValidAhpraNumberFormat(record.ahpraNumber)) {
    throw new CeremonyError('REQ-PKI-01', `"${record.ahpraNumber}" is not a valid AHPRA registration number format.`);
  }
  if (!record.ahpraRegistrationCurrent) {
    throw new CeremonyError(
      'REQ-PKI-01',
      'AHPRA registration was not verified as CURRENT. A key must not be bound to an unregistered practitioner.',
    );
  }

  // Check 2 — provider number and its location.
  if (!record.providerNumber?.trim()) {
    throw new CeremonyError('REQ-PKI-01', 'The provider number must be recorded and verified before a key is bound.');
  }
  if (!record.providerNumberLocation?.trim()) {
    throw new CeremonyError(
      'REQ-PKI-01',
      'The provider number must be verified AT A LOCATION — a number valid elsewhere proves nothing here.',
    );
  }
  if (!record.providerNumberVerified) {
    throw new CeremonyError('REQ-PKI-01', 'The provider number was recorded but not verified.');
  }

  // Check 3 — the person.
  if (!PERSON_VERIFICATION_METHODS.includes(record.personVerificationMethod)) {
    throw new CeremonyError(
      'REQ-PKI-01',
      `"${record.personVerificationMethod}" does not verify a person. Video or in person only — ` +
        'a key issued to whoever answered the email proves nothing.',
    );
  }

  // A named human, and not the subject.
  if (!record.verifiedByName?.trim()) {
    throw new CeremonyError('REQ-PKI-01', 'The ceremony must name the human who performed it.');
  }
  if (
    context.providerStaffId &&
    record.verifiedByStaffId &&
    context.providerStaffId === record.verifiedByStaffId
  ) {
    throw new CeremonyError(
      'REQ-PKI-01',
      'A practitioner cannot attest their own enrolment — self-attestation defeats the ceremony entirely.',
    );
  }

  // Freshness — a ceremony is a point in time, not a memory.
  const ageDays = (now.getTime() - record.performedAt.getTime()) / 86_400_000;
  if (ageDays > freshnessDays) {
    throw new CeremonyError(
      'REQ-PKI-04',
      `This ceremony is ${Math.floor(ageDays)} days old (limit ${freshnessDays}). AHPRA status must be ` +
        'checked on every high-risk action, and binding a key is one. Perform a fresh ceremony.',
    );
  }
  if (ageDays < 0) {
    throw new CeremonyError('REQ-PKI-01', 'A ceremony cannot be dated in the future.');
  }

  // REQ-PKI-05 — recovery is where an attacker applies pressure.
  if (context.isReEnrolment && !record.steppedUp) {
    throw new CeremonyError(
      'REQ-PKI-05',
      'This practitioner already holds a key, so this is RE-ENROLMENT — the weakest point in any ' +
        'device-bound scheme. It requires an explicitly stepped-up ceremony, and the practice principal is notified.',
    );
  }
}

/** Non-throwing form, for surfacing the gate in a UI before anyone tries. */
export function ceremonyFailures(record: CeremonyRecord, context: CeremonyContext): string[] {
  try {
    assertCeremonySufficient(record, context);
    return [];
  } catch (err) {
    return [(err as Error).message];
  }
}
