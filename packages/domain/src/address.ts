/**
 * Structured Australian addresses.
 *
 * WHY SIX FIELDS RATHER THAN ONE STRING. A single free-text line is fine for
 * printing and useless for matching, and matching is the point:
 *
 *   - the AHPRA register publishes a practitioner's principal place of practice
 *     as SUBURB + POSTCODE. Comparing that to a practice address is free,
 *     automatable, and the only check we have that ties a PERSON to a PLACE —
 *     which is precisely the entitlement gap (ORG-MODEL-PROPOSAL.md §11).
 *   - G-NAF matches on components, not on a sentence.
 *   - the ABR reports a locality for an ABN, which is a second independent
 *     source to agree or disagree with.
 *
 * None of that is possible against "1 Example St, Sampletown NSW 2000" as a
 * string, so the components are stored as components.
 *
 * WHAT IS DELIBERATELY NOT RESTRUCTURED: the PATIENT address. That one is an
 * approved identifier (REQ-VER-02) verified by constant-time comparison against
 * what a person says aloud at a desk. People do not speak in fields, and
 * splitting a spoken address into six of them would make a legitimate patient
 * fail verification because they said "Unit 3" where the record says "3/". It
 * stays a normalised string, matched as a string.
 */

export class AddressError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'AddressError';
  }
}

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export type AuState = (typeof AU_STATES)[number];

export interface StructuredAddress {
  /** Mandatory. Street number and name, or the postal equivalent. */
  readonly addressLine1: string;
  /** Unit, level, building. Optional and commonly empty. */
  readonly addressLine2?: string | null;
  readonly suburb: string;
  readonly state: string;
  readonly postcode: string;
  /** Defaults to Australia — a practice billing Medicare is in Australia. */
  readonly country?: string | null;
}

/**
 * ⚠ UNVERIFIED DATASET, on the same footing as the public-holiday calendar:
 * real, widely published, and not yet checked against an authoritative source.
 * Every consistency warning it produces says so.
 *
 * Ranges are inclusive. A postcode may be valid without appearing here (new
 * allocations happen), which is why a mismatch WARNS and never refuses — the
 * failure direction matters, and rejecting a real practice because our list is
 * stale is worse than accepting one with an odd postcode.
 */
export const STATE_POSTCODE_RANGES: Record<AuState, ReadonlyArray<readonly [number, number]>> = {
  NSW: [
    [1000, 2599],
    [2619, 2899],
    [2921, 2999],
  ],
  ACT: [
    [200, 299],
    [2600, 2618],
    [2900, 2920],
  ],
  VIC: [
    [3000, 3999],
    [8000, 8999],
  ],
  QLD: [
    [4000, 4999],
    [9000, 9999],
  ],
  SA: [
    [5000, 5999],
  ],
  WA: [
    [6000, 6797],
    [6800, 6999],
  ],
  TAS: [
    [7000, 7999],
  ],
  NT: [
    [800, 999],
  ],
};

export const POSTCODE_DATASET = {
  source: 'Widely published Australia Post allocations',
  verified: false,
} as const;

export function isKnownState(value: string): value is AuState {
  return (AU_STATES as readonly string[]).includes(value.trim().toUpperCase());
}

/** Four digits. Leading zeros matter — NT and ACT use them. */
export function isValidPostcodeFormat(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}

export function postcodeMatchesState(postcode: string, state: string): boolean {
  const normalisedState = state.trim().toUpperCase();
  if (!isKnownState(normalisedState) || !isValidPostcodeFormat(postcode)) return false;
  const numeric = Number(postcode.trim());
  return STATE_POSTCODE_RANGES[normalisedState].some(([low, high]) => numeric >= low && numeric <= high);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The bar for a PLACE OF PRACTICE, whose address is rendered into the s 65C(5)(a)
 * particulars. Line 2 and country are the only optional parts.
 */
export function assertAddressUsable(address: StructuredAddress): void {
  if (!address.addressLine1?.trim()) {
    throw new AddressError('FR-1.1', 'Address line 1 is required.');
  }
  if (!address.suburb?.trim()) {
    throw new AddressError('FR-1.1', 'A suburb is required — it is what the AHPRA register and G-NAF match on.');
  }
  if (!address.state?.trim()) {
    throw new AddressError(
      'REQ-OFF-03',
      'A state is required: it selects the public-holiday calendar used for 2-business-day terminations.',
    );
  }
  if (!isKnownState(address.state)) {
    throw new AddressError(
      'REQ-OFF-03',
      `"${address.state}" is not an Australian state or territory. One of ${AU_STATES.join(', ')}.`,
    );
  }
  if (!isValidPostcodeFormat(address.postcode ?? '')) {
    throw new AddressError('FR-1.1', `"${address.postcode}" is not a four-digit Australian postcode.`);
  }
}

export interface AddressWarning {
  readonly code: 'postcode_state_mismatch' | 'non_australian';
  readonly message: string;
}

/** Non-blocking observations, for the same reason G-NAF gaps are non-blocking. */
export function addressWarnings(address: StructuredAddress): AddressWarning[] {
  const warnings: AddressWarning[] = [];

  const country = (address.country ?? 'Australia').trim().toLowerCase();
  if (country && country !== 'australia' && country !== 'au') {
    warnings.push({
      code: 'non_australian',
      message:
        `Country is recorded as "${address.country}". A practice billing Medicare operates in Australia, so ` +
        'this is worth a second look before approval.',
    });
  }

  if (isKnownState(address.state) && isValidPostcodeFormat(address.postcode ?? '')) {
    if (!postcodeMatchesState(address.postcode, address.state)) {
      warnings.push({
        code: 'postcode_state_mismatch',
        message:
          `Postcode ${address.postcode} is outside the usual ranges for ${address.state.toUpperCase()}. ` +
          'NOT A BLOCK — our postcode list is unverified and new allocations happen. Worth checking the ' +
          'address is right.',
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Rendering and parsing
// ---------------------------------------------------------------------------

/** The single line that goes into a s 65C particulars block. */
export function formatAddress(address: StructuredAddress): string {
  const street = [address.addressLine2?.trim(), address.addressLine1?.trim()].filter(Boolean).join(', ');
  const locality = [address.suburb?.trim(), address.state?.trim().toUpperCase(), address.postcode?.trim()]
    .filter(Boolean)
    .join(' ');
  const country = (address.country ?? 'Australia').trim();
  const parts = [street, locality];
  if (country && country.toLowerCase() !== 'australia') parts.push(country);
  return parts.filter(Boolean).join(', ');
}

/**
 * Best-effort split of a single line, for migrating existing records and for
 * pre-filling the six fields from something already typed.
 *
 * DELIBERATELY LOSSY, AND HONEST ABOUT IT. It returns what it could work out
 * and nothing more; anything it cannot place is left blank for a human rather
 * than guessed at. A confidently wrong suburb is worse than an empty one,
 * because the whole point of these fields is matching.
 */
export function parseSingleLine(line: string): Partial<StructuredAddress> & { readonly parsed: boolean } {
  const trimmed = (line ?? '').trim();
  if (!trimmed) return { parsed: false };

  // "… SUBURB STATE 2000" — anchored at the end, which is the only reliably
  // ordered part of an Australian address.
  const tail = /^(.*?)[,\s]+([A-Za-z' -]+?)[,\s]+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)[,\s]+(\d{4})\s*$/i.exec(trimmed);
  if (!tail) return { parsed: false };

  const [, street, suburb, state, postcode] = tail;
  const streetParts = street.split(',').map((p) => p.trim()).filter(Boolean);

  return {
    parsed: true,
    // Where there are two street parts, the FIRST is the unit/level in
    // Australian convention ("Unit 3, 1 Example Street").
    addressLine1: streetParts.length > 1 ? streetParts.slice(1).join(', ') : (streetParts[0] ?? ''),
    addressLine2: streetParts.length > 1 ? streetParts[0] : null,
    suburb: suburb.trim(),
    state: state.toUpperCase(),
    postcode,
    country: 'Australia',
  };
}

// ---------------------------------------------------------------------------
// Locality matching — the reason this module exists
// ---------------------------------------------------------------------------

export type LocalityMatch = 'match' | 'postcode_only' | 'suburb_only' | 'mismatch' | 'insufficient_data';

export interface LocalityComparison {
  readonly result: LocalityMatch;
  readonly message: string;
}

function normaliseSuburb(value: string | null | undefined): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compare a practice address against the principal place of practice AHPRA
 * publishes for a practitioner (suburb + postcode only — the register carries
 * no street address).
 *
 * This is a SIGNAL, not a gate, and the reasons matter. A practitioner
 * legitimately works at several locations and the register names only their
 * PRINCIPAL one, so a mismatch is common and innocent. What makes it worth
 * computing is the other direction: when it matches, an independent regulator
 * has placed this person in this locality, which nothing else we hold does.
 */
export function compareLocality(
  practice: Pick<StructuredAddress, 'suburb' | 'postcode'>,
  register: { readonly suburb?: string | null; readonly postcode?: string | null },
): LocalityComparison {
  const practiceSuburb = normaliseSuburb(practice.suburb);
  const registerSuburb = normaliseSuburb(register.suburb);
  const practicePostcode = (practice.postcode ?? '').trim();
  const registerPostcode = (register.postcode ?? '').trim();

  if ((!registerSuburb && !registerPostcode) || (!practiceSuburb && !practicePostcode)) {
    return {
      result: 'insufficient_data',
      message: 'One side has no locality recorded, so nothing can be compared.',
    };
  }

  const suburbAgrees = Boolean(practiceSuburb) && practiceSuburb === registerSuburb;
  const postcodeAgrees = Boolean(practicePostcode) && practicePostcode === registerPostcode;

  if (suburbAgrees && postcodeAgrees) {
    return {
      result: 'match',
      message:
        'AHPRA places this practitioner’s principal place of practice in the same locality as this practice. ' +
        'An independent regulator has connected this person to this place.',
    };
  }
  if (postcodeAgrees) {
    return {
      result: 'postcode_only',
      message: `Postcodes agree (${practicePostcode}) but the suburbs differ — often just a naming variant.`,
    };
  }
  if (suburbAgrees) {
    return {
      result: 'suburb_only',
      message: `Suburbs agree (${practice.suburb}) but the postcodes differ. Worth a look; suburb names repeat across states.`,
    };
  }
  return {
    result: 'mismatch',
    message:
      `AHPRA records this practitioner’s principal place of practice as ${register.suburb ?? '—'} ` +
      `${register.postcode ?? ''}, not ${practice.suburb} ${practice.postcode}. NOT A BLOCK — practitioners ` +
      'work at several locations and the register names only the principal one — but if this person is being ' +
      'offered as proof the practice is real, it is proof of somewhere else.',
  };
}
