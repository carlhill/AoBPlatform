/**
 * ABN / ACN validation for organisation onboarding.
 *
 * Two independent things happen at onboarding and they must not be confused:
 *
 *   1. CHECKSUM — is this string even shaped like an ABN? Pure arithmetic,
 *      offline, no network. Catches typos before anyone waits on a lookup.
 *   2. REGISTER STATE — does the ABR say this ABN is ACTIVE, and does the
 *      name the operator typed match what is registered? That needs the ABR.
 *
 * This module owns (1) and the name-matching half of (2). The ABR call itself
 * lives in the service layer, because it is I/O.
 *
 * A valid checksum means nothing about whether the business exists. Both
 * gates are required, and the human validation queue sits behind both.
 */

export class AbnError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'AbnError';
  }
}

/** Strip the spaces the ABR itself prints ("51 824 753 556"). */
export function normaliseAbn(value: string): string {
  return value.replace(/[\s-]/g, '');
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * The ATO's published ABN check: subtract 1 from the leading digit, apply the
 * weights, and the weighted sum must be divisible by 89.
 */
export function isValidAbnChecksum(value: string): boolean {
  const abn = normaliseAbn(value);
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split('').map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

/** ASIC's ACN check digit: complement of the weighted sum modulo 10. */
export function isValidAcnChecksum(value: string): boolean {
  const acn = normaliseAbn(value);
  if (!/^\d{9}$/.test(acn)) return false;
  const digits = acn.split('').map(Number);
  const sum = ACN_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (10 - (sum % 10)) % 10 === digits[8];
}

/**
 * For a company, the ABN is the ACN with two check digits prefixed — so the
 * ACN is simply the last nine digits. We DERIVE it rather than asking, and
 * treat a supplied-but-different ACN as a hard failure worth surfacing.
 *
 * Returns null when the input is not a well-formed ABN, or when the trailing
 * nine digits do not themselves pass the ACN check — which is the normal case
 * for a sole trader or partnership, who have an ABN but no ACN at all.
 */
export function deriveAcnFromAbn(abn: string): string | null {
  const normalised = normaliseAbn(abn);
  if (!/^\d{11}$/.test(normalised)) return null;
  const candidate = normalised.slice(2);
  return isValidAcnChecksum(candidate) ? candidate : null;
}

/** ABR entity types that are companies, and therefore must carry an ACN. */
export const COMPANY_ENTITY_TYPES = ['PTY_LTD', 'PUBLIC_COMPANY'] as const;

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * Practices trade under a name that is not their legal entity name, routinely:
 * legal entity "Smith Medical Pty Ltd" trading as "Sampletown Family Practice".
 * Demanding an exact match on the legal name would reject most real practices.
 *
 * So we match the typed name against the legal name OR any registered business
 * name, and report WHICH one matched so the operator can see it.
 */
export type NameMatchTier = 'exact' | 'entity_suffix_insensitive' | 'none';

export interface NameMatch {
  readonly tier: NameMatchTier;
  /** The registered name that matched, verbatim as the ABR returned it. */
  readonly matched?: string;
  /** Where it matched — the operator should see this. */
  readonly source?: 'legal_name' | 'business_name';
}

/** Uppercase, drop punctuation, collapse whitespace. Nothing semantic. */
function normaliseName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Legal-entity suffixes carry no distinguishing information — "Smith Medical
 * Pty Ltd" and "Smith Medical" are the same practice to every human involved.
 * Stripping them is a SEPARATE, weaker tier so the operator can see that the
 * match was inexact rather than having it silently upgraded.
 */
const ENTITY_SUFFIXES = [
  'PROPRIETARY LIMITED',
  'PTY LIMITED',
  'PTY LTD',
  'LIMITED',
  'LTD',
  'INCORPORATED',
  'INC',
  'THE TRUSTEE FOR',
  'AS TRUSTEE FOR',
  'ATF',
];

function stripEntitySuffix(value: string): string {
  let out = normaliseName(value);
  for (const suffix of ENTITY_SUFFIXES) {
    if (out.startsWith(suffix + ' ')) out = out.slice(suffix.length + 1);
    if (out.endsWith(' ' + suffix)) out = out.slice(0, -(suffix.length + 1));
  }
  return out.trim();
}

export interface RegisteredNames {
  readonly legalName: string;
  readonly businessNames?: readonly string[];
}

export function matchOrganisationName(typed: string, registered: RegisteredNames): NameMatch {
  const candidates: Array<{ name: string; source: 'legal_name' | 'business_name' }> = [
    { name: registered.legalName, source: 'legal_name' },
    ...(registered.businessNames ?? []).map((name) => ({ name, source: 'business_name' as const })),
  ];

  const typedExact = normaliseName(typed);
  for (const candidate of candidates) {
    if (normaliseName(candidate.name) === typedExact) {
      return { tier: 'exact', matched: candidate.name, source: candidate.source };
    }
  }

  const typedStripped = stripEntitySuffix(typed);
  if (typedStripped) {
    for (const candidate of candidates) {
      if (stripEntitySuffix(candidate.name) === typedStripped) {
        return { tier: 'entity_suffix_insensitive', matched: candidate.name, source: candidate.source };
      }
    }
  }

  return { tier: 'none' };
}

// ---------------------------------------------------------------------------
// The onboarding gate
// ---------------------------------------------------------------------------

/** What the ABR gives back, reduced to the fields the gate actually uses. */
export interface AbrLookup {
  readonly abn: string;
  /** The ABR's own status string, normalised upstream to ACTIVE / CANCELLED. */
  readonly abnStatus: string;
  readonly legalName: string;
  readonly businessNames?: readonly string[];
  /** ABR entity type, mapped to our vocabulary. */
  readonly entityType: string;
  readonly gstRegistered?: boolean;
}

export interface OrganisationApplication {
  readonly typedName: string;
  readonly abn: string;
  /** Optional — we derive it. Supplied and disagreeing is a hard failure. */
  readonly acn?: string;
}

export interface OrganisationGateResult {
  readonly abn: string;
  readonly acn: string | null;
  readonly nameMatch: NameMatch;
  readonly legalName: string;
  readonly businessNames: readonly string[];
  readonly entityType: string;
  readonly gstRegistered: boolean;
}

/**
 * Throws unless the ABN is well-formed and ACTIVE, the typed name matches a
 * registered name, and any supplied ACN agrees with the one derived from the
 * ABN. Passing this does NOT create an organisation — it queues one for human
 * validation (see §4 of ORG-MODEL-PROPOSAL.md).
 */
export function assertOrganisationApplicationValid(
  application: OrganisationApplication,
  lookup: AbrLookup,
): OrganisationGateResult {
  const abn = normaliseAbn(application.abn);

  if (!isValidAbnChecksum(abn)) {
    throw new AbnError('FR-1.1', `"${application.abn}" is not a valid ABN — the check digits do not agree.`);
  }
  if (normaliseAbn(lookup.abn) !== abn) {
    throw new AbnError('FR-1.1', 'The ABR lookup returned a different ABN than the one applied for.');
  }

  // Binary, and deliberately strict. A cancelled ABN cannot bulk bill.
  if (lookup.abnStatus.toUpperCase() !== 'ACTIVE') {
    throw new AbnError(
      'FR-1.1',
      `This ABN is ${lookup.abnStatus} on the ABR, not ACTIVE. A practice cannot be onboarded against a ` +
        'cancelled ABN — the entity that would be assigning benefits does not currently exist.',
    );
  }

  const nameMatch = matchOrganisationName(application.typedName, {
    legalName: lookup.legalName,
    businessNames: lookup.businessNames,
  });
  if (nameMatch.tier === 'none') {
    const known = [lookup.legalName, ...(lookup.businessNames ?? [])].join(', ');
    throw new AbnError(
      'FR-1.1',
      `"${application.typedName}" does not match any name registered against this ABN (${known}). ` +
        'Use the legal entity name or a registered business name.',
    );
  }

  const derivedAcn = deriveAcnFromAbn(abn);
  if (application.acn) {
    const supplied = normaliseAbn(application.acn);
    if (!isValidAcnChecksum(supplied)) {
      throw new AbnError('FR-1.1', `"${application.acn}" is not a valid ACN — the check digit does not agree.`);
    }
    if (derivedAcn && supplied !== derivedAcn) {
      throw new AbnError(
        'FR-1.1',
        'The ACN supplied does not match the one embedded in this ABN. For a company the ABN is the ACN with ' +
          'two check digits prefixed, so these can never legitimately differ.',
      );
    }
  }

  if ((COMPANY_ENTITY_TYPES as readonly string[]).includes(lookup.entityType) && !derivedAcn) {
    // The overwhelmingly common cause is the entity type being wrong rather
    // than the ABN being wrong, and a trust is the case that trips people:
    // "The trustee for X Family Trust" is a TRUST, and a trust has no ACN of
    // its own. Saying so beats restating the rule.
    const looksLikeTrust = /\btrust(ee)?\b/i.test(lookup.legalName);
    throw new AbnError(
      'FR-1.1',
      `This entity is recorded as ${lookup.entityType}, which must have an ACN, but none could be derived ` +
        `from ABN ${abn}. ` +
        (looksLikeTrust
          ? `The registered name "${lookup.legalName}" reads like a TRUST — a trust has no ACN of its own, so ` +
            'choose TRUST rather than a company type.'
          : 'Check the entity type against what the ABR actually shows, or refer to human validation.'),
    );
  }

  return {
    abn,
    acn: derivedAcn,
    nameMatch,
    legalName: lookup.legalName,
    businessNames: lookup.businessNames ?? [],
    entityType: lookup.entityType,
    gstRegistered: lookup.gstRegistered ?? false,
  };
}
