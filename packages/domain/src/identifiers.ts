/**
 * Patient identity verification — the approved identifier set.
 *
 * REQ-VER-02 / CLAUDE.md hard rule 1: the ONLY approved identifiers are the six
 * RACGP 5th-edition identifiers below. The Medicare card number is explicitly
 * NOT approved (shared card numbers, not unique to an individual) and its
 * exclusion is NON-CONFIGURABLE. This is "the single most likely design
 * mistake in this product" — hence the exclusion is enforced here in code, in
 * the ESLint config, and by HARD-03 (never stored anywhere).
 *
 * Verification evidence stores identifier TYPES and outcomes only — never
 * values (REQ-VER-04, HARD-04).
 */

export const APPROVED_IDENTIFIER_TYPES = [
  /** Family + given names together count as ONE identifier. */
  'name',
  'date_of_birth',
  /** As identified by the patient. */
  'gender',
  'address',
  'patient_record_number',
  /** Individual Healthcare Identifier (16-digit). */
  'ihi',
] as const;

export type ApprovedIdentifierType = (typeof APPROVED_IDENTIFIER_TYPES)[number];

/** Floor on how many identifiers must be challenged (REQ-VER-06: configurable per practice, floor 3, default 3). */
export const IDENTIFIER_COUNT_FLOOR = 3;

export function isApprovedIdentifierType(value: string): value is ApprovedIdentifierType {
  return (APPROVED_IDENTIFIER_TYPES as readonly string[]).includes(value);
}

/**
 * Validates a practice's configured identifier challenge set.
 * Throws on any non-approved type (including any Medicare-card variant) and on
 * fewer than the floor. The exclusion is not configurable — there is no
 * override parameter, deliberately.
 */
export function assertValidIdentifierSet(types: readonly string[]): asserts types is readonly ApprovedIdentifierType[] {
  for (const t of types) {
    if (!isApprovedIdentifierType(t)) {
      throw new IdentifierSetError(
        `"${t}" is not an approved patient identifier. Approved set (RACGP 5th ed, REQ-VER-02): ` +
          APPROVED_IDENTIFIER_TYPES.join(', ') +
          '. The Medicare card number is explicitly excluded and this is not configurable.',
      );
    }
  }
  if (new Set(types).size < IDENTIFIER_COUNT_FLOOR) {
    throw new IdentifierSetError(
      `At least ${IDENTIFIER_COUNT_FLOOR} distinct approved identifiers are required (REQ-VER-01/-06).`,
    );
  }
}

export class IdentifierSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentifierSetError';
  }
}

/**
 * A verification event record — types and outcomes only, never values
 * (REQ-VER-04, HARD-04). There is intentionally no field capable of carrying
 * an identifier value.
 */
export interface VerificationEvidence {
  readonly identifierTypesChallenged: readonly ApprovedIdentifierType[];
  readonly outcome: 'passed' | 'failed' | 'locked_out';
  readonly channel: 'in_practice' | 'sms_link' | 'email_link' | 'portal' | 'paper';
  /** Present only for staff-verified in-practice capture. */
  readonly verifiedByStaffId?: string;
}
