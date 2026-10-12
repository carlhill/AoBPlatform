/**
 * How a location's address was confirmed, and why it was refused.
 *
 * A LOCATION'S ADDRESS IS NOT ADMINISTRATIVE DATA. It prints in the
 * s 65C(5)(a) particulars block of every agreement captured at that site, so
 * confirming one is verifying evidence that will appear on legal records of
 * consent. That is why the practice supplying it cannot be the party that
 * confirms it, and why "confirmed" on its own is not enough: a record that
 * somebody confirmed something, without saying HOW, cannot be weighed by
 * anybody later — including us, including a regulator, including the reviewer
 * themselves in six months.
 *
 * The methods below are ordered by how hard they are to fake, and each one
 * says plainly what it does and does not establish. They deliberately mirror
 * the entitlement-check catalogue in checks.ts: entering a thing scores
 * nothing, and only a recorded check by somebody independent gives it weight.
 */

/**
 * The catalogue version. Versioned like the check catalogue, for the same
 * reason — a v1 confirmation must read as v1 for ever, whatever we decide
 * later.
 */
export const ADDRESS_CHECK_VERSION = '1';

export interface AddressCheckMethod {
  key: string;
  label: string;
  /** What this actually establishes. Written for the reviewer, at the moment they choose. */
  establishes: string;
  /** What it does NOT establish, which is the half people skip. */
  limits: string;
  /**
   * Whether the method is meaningless without an uploaded artefact.
   *
   * A document-based method with no document is not a weaker check — it is an
   * ASSERTION WEARING A CHECK'S NAME, and it would read in the audit trail as
   * though a document had been examined.
   */
  requiresDocument: boolean;
  /**
   * STRONG   — independent of anything the practice controls
   * MODERATE — the practice supplied it, but forging it takes real effort
   * WEAK     — consistent with the claim, easily produced by the claimant
   */
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
}

export const ADDRESS_CHECK_METHODS: readonly AddressCheckMethod[] = [
  {
    key: 'site_visit',
    label: 'Somebody attended the address',
    establishes: 'That the premises exist and the practice is operating there.',
    limits: 'Says nothing about who is entitled to bill from it.',
    requiresDocument: false,
    strength: 'STRONG',
  },
  {
    key: 'government_register',
    label: 'Matched against a government or regulator register',
    establishes: 'That an independent authority holds this address for this entity.',
    limits: 'Registers lag. A recent move may not have reached it yet.',
    requiresDocument: true,
    strength: 'STRONG',
  },
  {
    key: 'call_to_published_number',
    label: 'Called a number we found ourselves, not one they gave us',
    establishes: 'That somebody answering the practice’s own published line confirms the address.',
    limits:
      'Only as independent as the number. A number supplied by the applicant proves nothing — ' +
      'this is the same rule as an entitlement callback (FR-1.9).',
    requiresDocument: false,
    strength: 'STRONG',
  },
  {
    key: 'lease_or_utility_document',
    label: 'Lease, rates notice or utility bill for the premises',
    establishes: 'That the entity has a commercial relationship tied to that address.',
    limits: 'The practice chose which document to send.',
    requiresDocument: true,
    strength: 'MODERATE',
  },
  {
    key: 'practice_letterhead',
    label: 'The practice’s own letterhead or published material',
    establishes: 'That the practice holds this address out publicly as its own.',
    limits: 'Produced entirely by the practice. Consistent with the claim, not independent of it.',
    requiresDocument: true,
    strength: 'WEAK',
  },
  {
    key: 'other',
    label: 'Something else — described in the note',
    establishes: 'Whatever the note says, and nothing that the note does not say.',
    limits: 'Unclassifiable, so it cannot be weighed automatically. The note is the whole record.',
    requiresDocument: false,
    strength: 'WEAK',
  },
] as const;

export const ADDRESS_CHECK_KEYS = ADDRESS_CHECK_METHODS.map((m) => m.key);

export function addressCheckMethod(key: string): AddressCheckMethod | undefined {
  return ADDRESS_CHECK_METHODS.find((m) => m.key === key);
}

/** Why a reviewer sent an address back. The practice sees this, so it is written for them. */
export interface AddressRejectionReason {
  key: string;
  /** Shown to the reviewer choosing it. */
  label: string;
  /** Shown to the PRACTICE. Says what to do, not merely what was wrong. */
  practiceGuidance: string;
  /** Whether the reviewer must add detail. Used where the reason alone cannot be acted on. */
  requiresDetail: boolean;
}

export const ADDRESS_REJECTION_REASONS: readonly AddressRejectionReason[] = [
  {
    key: 'address_incomplete',
    label: 'Incomplete — missing unit, level or street number',
    practiceGuidance:
      'The address is missing something we need to identify the premises exactly. Add the unit, ' +
      'level or street number and save it again.',
    requiresDetail: false,
  },
  {
    key: 'address_not_found',
    label: 'We could not find these premises',
    practiceGuidance:
      'We could not locate these premises from the address given. Check the street name, suburb ' +
      'and postcode, correct anything wrong, and save it again.',
    requiresDetail: false,
  },
  {
    key: 'not_a_clinical_site',
    label: 'Looks like a postal or registered-office address',
    practiceGuidance:
      'This looks like a postal or registered-office address rather than somewhere patients are ' +
      'seen. A location must be a place where care is delivered, because its address prints on ' +
      'the agreements captured there. Enter the clinical address instead.',
    requiresDetail: false,
  },
  {
    key: 'evidence_inconsistent',
    label: 'Our evidence shows a different address',
    practiceGuidance:
      'What we checked shows a different address from the one entered. Please confirm which is ' +
      'correct and update the location, or contact us if you believe ours is out of date.',
    requiresDetail: true,
  },
  {
    key: 'other',
    label: 'Something else — explained below',
    practiceGuidance: 'See the note below.',
    requiresDetail: true,
  },
] as const;

export const ADDRESS_REJECTION_KEYS = ADDRESS_REJECTION_REASONS.map((r) => r.key);

export function addressRejectionReason(key: string): AddressRejectionReason | undefined {
  return ADDRESS_REJECTION_REASONS.find((r) => r.key === key);
}

export class AddressCheckError extends Error {}

/**
 * Is this confirmation recordable?
 *
 * THROWS RATHER THAN RETURNING FALSE, because every caller here is about to
 * write an append-only vault event. A boolean invites a caller to carry on
 * with a default; an exception does not.
 */
export function assertRecordableCheck(input: {
  method: string;
  artefactId?: string | null;
  note?: string | null;
}): AddressCheckMethod {
  const method = addressCheckMethod(input.method);
  if (!method) {
    throw new AddressCheckError(
      `"${input.method}" is not an address check method. One of: ${ADDRESS_CHECK_KEYS.join(', ')}.`,
    );
  }
  if (method.requiresDocument && !input.artefactId) {
    throw new AddressCheckError(
      `"${method.label}" is a document check, so the document has to be attached. Without it the ` +
        'record would say a document was examined when none was.',
    );
  }
  if (method.key === 'other' && !input.note?.trim()) {
    throw new AddressCheckError(
      'Choosing "something else" means the note IS the record. Describe what was checked.',
    );
  }
  return method;
}

/** Is this rejection sendable? Same reasoning as above — the practice acts on it. */
export function assertSendableRejection(input: {
  reason: string;
  detail?: string | null;
}): AddressRejectionReason {
  const reason = addressRejectionReason(input.reason);
  if (!reason) {
    throw new AddressCheckError(
      `"${input.reason}" is not a rejection reason. One of: ${ADDRESS_REJECTION_KEYS.join(', ')}.`,
    );
  }
  if (reason.requiresDetail && !input.detail?.trim()) {
    throw new AddressCheckError(
      `"${reason.label}" cannot be acted on by itself. Say what we found, so the practice knows ` +
        'what to change.',
    );
  }
  return reason;
}

/**
 * What the practice is allowed to do with a location right now.
 *
 * EDITING STOPS AT CONFIRMATION, and that is the whole rule. Before it, the
 * address is a claim the practice is still making and correcting it is
 * ordinary work. After it, somebody independent has checked it and it may
 * already be printed on captured agreements — changing it silently would
 * invalidate that check while leaving the confirmation record standing, which
 * is worse than never having checked at all.
 *
 * A confirmed address is not frozen for ever; it goes back through review.
 * That path is deliberately not this function.
 */
export function locationEditability(location: {
  addressValidated?: boolean | null;
  active?: boolean | null;
  addressRejectedAt?: Date | string | null;
}): {
  mayEdit: boolean;
  /** Why not, in words the practice can act on. */
  reason?: string;
  /** True when a reviewer sent it back and the practice has not yet resaved it. */
  awaitingCorrection: boolean;
} {
  const confirmed = Boolean(location.addressValidated);
  const awaitingCorrection = Boolean(location.addressRejectedAt) && !confirmed;

  if (confirmed) {
    return {
      mayEdit: false,
      reason:
        'This address has been confirmed by AoBPlatform and may already appear on captured ' +
        'agreements. Ask us to review it rather than editing it here.',
      awaitingCorrection: false,
    };
  }
  return { mayEdit: true, awaitingCorrection };
}
