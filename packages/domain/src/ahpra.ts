/**
 * The AHPRA public register, as it actually behaves.
 *
 * Verified against the live register (21 August 2026). A practitioner record
 * carries: profession, division, registration number, registration status,
 * conditions, undertakings, reprimands, date of first registration, then ONE
 * OR MORE registration types — each with its own expiry date, conditions,
 * endorsements, notations and requirements — plus qualifications and the
 * principal place of practice as SUBURB, STATE, POSTCODE, COUNTRY.
 *
 * Three things about it shape this module:
 *
 * 1. THERE IS NO PRACTICE ON THE REGISTER. AHPRA registers individuals. No
 *    lookup here can tell you a clinic exists, is real, or that an applicant
 *    represents it — that is the entitlement problem, and it lives elsewhere.
 *
 * 2. EXPIRY IN THE PAST IS NOT A BLOCK. Quoting the register verbatim:
 *    "Sometimes a practitioner will appear on the register with a registration
 *    expiry date that is in the past. This may be because their renewal
 *    application is still being finalised, or during a one month 'late period'
 *    after the expiry date. However, they are still able to practise."
 *    Blocking on it would lock legitimately-practising doctors out of consent
 *    capture every renewal season. It is a WARNING, never a refusal.
 *
 * 3. A PRACTITIONER HOLDS SEVERAL REGISTRATION TYPES AT ONCE. The one we
 *    checked held General AND Specialist (General practice), each with its own
 *    expiry. Modelling expiry as a single scalar would silently pick one.
 */

export class AhpraError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'AhpraError';
  }
}

/**
 * Registration status, as the register words it.
 *
 * Only `Registered` permits practice. The others are listed so that an
 * unrecognised value is treated as unknown rather than quietly waved through —
 * a status we do not understand must never read as "fine".
 */
export const AHPRA_REGISTRATION_STATUSES = [
  'Registered',
  'Suspended',
  'Cancelled',
  'Surrendered',
  'Lapsed',
  'Not currently registered',
] as const;
export type AhpraRegistrationStatus = (typeof AHPRA_REGISTRATION_STATUSES)[number];

/** One registration type held by a practitioner. Several may be held at once. */
export interface AhpraRegistrationType {
  /** "General", "Specialist", "Limited", "Provisional", "Non-practising". */
  readonly registrationType: string;
  /** Present on specialist registrations, e.g. "General practice". */
  readonly specialty?: string | null;
  readonly expiryDate?: Date | null;
  /** Verbatim from the register. "None" is a real and common value. */
  readonly conditions?: string | null;
  readonly endorsements?: string | null;
  readonly notations?: string | null;
}

export interface AhpraRecord {
  readonly registrationNumber: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly profession: string;
  readonly division?: string | null;
  readonly registrationStatus: string;
  /** Practitioner-level restrictions, distinct from per-type ones. */
  readonly conditions?: string | null;
  readonly undertakings?: string | null;
  readonly reprimands?: string | null;
  readonly dateOfFirstRegistration?: Date | null;
  readonly registrationTypes: readonly AhpraRegistrationType[];
  /** The register publishes only this much of the address. Never a street. */
  readonly principalSuburb?: string | null;
  readonly principalState?: string | null;
  readonly principalPostcode?: string | null;
  readonly principalCountry?: string | null;
}

/** Text the register uses for "nothing here". Anything else is a real entry. */
const EMPTY_VALUES = new Set(['', 'none', 'n/a', 'nil', '-']);

export function hasRestriction(value: string | null | undefined): boolean {
  return !EMPTY_VALUES.has((value ?? '').trim().toLowerCase());
}

/**
 * A blocking check, and a deliberately narrow one: only the registration
 * STATUS refuses. Everything else warns.
 */
export function assertRegistrationPermitsPractice(record: AhpraRecord): void {
  const status = record.registrationStatus?.trim();

  if (!status) {
    throw new AhpraError('REQ-PKI-04', 'No registration status was recorded, so nothing has been verified.');
  }
  if (status === 'Registered') return;

  if ((AHPRA_REGISTRATION_STATUSES as readonly string[]).includes(status)) {
    throw new AhpraError(
      'REQ-XFER-08',
      `AHPRA records this practitioner as ${status}, not Registered. They cannot be affiliated, and any ` +
        'existing affiliation ends immediately — there is no notice period for a loss of registration.',
    );
  }
  // An unrecognised status is NOT assumed benign.
  throw new AhpraError(
    'REQ-PKI-04',
    `"${status}" is not a registration status this system recognises. It is treated as not-registered rather ` +
      'than waved through: a status we cannot interpret must never read as permission.',
  );
}

export interface RegistrationWarning {
  readonly code: 'expiry_passed' | 'conditions' | 'undertakings' | 'reprimands' | 'stale_check' | 'no_types';
  readonly message: string;
}

/** ⚠ DRAFT PARAMETER — how old a sighting may be before it wants redoing. */
export const REGISTRATION_RECHECK_DAYS = 90;

/**
 * Everything worth showing a human, none of it blocking.
 *
 * Conditions and undertakings are the ones that matter most here and are the
 * easiest to skim past: a practitioner may be perfectly registered and still
 * restricted in what they may do. Surfacing them is the point.
 */
export function registrationWarnings(
  record: AhpraRecord,
  options: { sightedAt?: Date | null; now?: Date; recheckDays?: number } = {},
): RegistrationWarning[] {
  const now = options.now ?? new Date();
  const warnings: RegistrationWarning[] = [];

  if (record.registrationTypes.length === 0) {
    warnings.push({
      code: 'no_types',
      message: 'No registration types were recorded. The register always shows at least one.',
    });
  }

  const expired = record.registrationTypes.filter((t) => t.expiryDate && t.expiryDate < now);
  if (expired.length > 0) {
    warnings.push({
      code: 'expiry_passed',
      message:
        `Registration expiry has passed for: ${expired.map((t) => t.registrationType).join(', ')}. ` +
        'THIS IS NOT A BLOCK. AHPRA states that a past expiry date may mean a renewal is still being ' +
        'finalised, or that the practitioner is in the one-month late period — they are still able to ' +
        'practise. Worth re-checking the register, not worth refusing them.',
    });
  }

  if (hasRestriction(record.conditions) || record.registrationTypes.some((t) => hasRestriction(t.conditions))) {
    warnings.push({
      code: 'conditions',
      message:
        'This registration carries CONDITIONS. A practitioner may be fully registered and still restricted ' +
        'in what they may do — read them before affiliating.',
    });
  }
  if (hasRestriction(record.undertakings)) {
    warnings.push({ code: 'undertakings', message: 'This practitioner has given UNDERTAKINGS. Read them.' });
  }
  if (hasRestriction(record.reprimands)) {
    warnings.push({ code: 'reprimands', message: 'This practitioner has been REPRIMANDED. Read the entry.' });
  }

  if (options.sightedAt) {
    const ageDays = (now.getTime() - options.sightedAt.getTime()) / 86_400_000;
    const limit = options.recheckDays ?? REGISTRATION_RECHECK_DAYS;
    if (ageDays > limit) {
      warnings.push({
        code: 'stale_check',
        message:
          `The register was last sighted ${Math.floor(ageDays)} days ago (limit ${limit}). Registration can ` +
          'lapse or be suspended at any time, and nothing here would have noticed.',
      });
    }
  }

  return warnings;
}

/**
 * Does the AHPRA profession support the provider type a practice is asserting?
 *
 * THE SCENARIO THIS ANSWERS: a practice affiliates somebody as a GP whose
 * register entry says Nurse. On its own that is a data-entry error most of the
 * time — but it is also the shape of a practice using a real registration
 * number for a role its holder cannot fill, and it is free to detect because
 * the register publishes the profession.
 *
 * A SIGNAL, NOT A GATE. Profession names vary, scopes overlap, and a nurse
 * practitioner genuinely can render some items a registered nurse cannot.
 * Refusing on a string comparison would block legitimate affiliations; the
 * mismatch is surfaced for a human instead.
 *
 * Note also what this does NOT do: it does not stop anyone billing Medicare.
 * MBS item eligibility is tied to provider type and Services Australia applies
 * those edits. This catches the misuse EARLIER, at the point somebody claims a
 * role, and only within this platform.
 */
export const PROVIDER_TYPE_PROFESSIONS: Record<string, readonly string[]> = {
  general_practitioner: ['medical practitioner'],
  specialist: ['medical practitioner'],
  nurse_practitioner: ['nurse', 'nurse and midwife', 'midwife'],
  optometrist: ['optometrist'],
  allied_health: [
    'physiotherapist',
    'psychologist',
    'occupational therapist',
    'chiropractor',
    'osteopath',
    'podiatrist',
    'pharmacist',
    'dental practitioner',
    'chinese medicine practitioner',
    'aboriginal and torres strait islander health practitioner',
    'medical radiation practitioner',
    'paramedic',
  ],
  other: [],
};

export type ProfessionMatch = 'consistent' | 'mismatch' | 'unknown';

export interface ProfessionComparison {
  readonly result: ProfessionMatch;
  readonly message: string;
}

export function compareProfession(providerType: string, registerProfession?: string | null): ProfessionComparison {
  const profession = (registerProfession ?? '').trim().toLowerCase();
  if (!profession) {
    return {
      result: 'unknown',
      message: 'The register has not been checked for this practitioner, so their profession is unknown.',
    };
  }

  const expected = PROVIDER_TYPE_PROFESSIONS[providerType];
  if (!expected || expected.length === 0) {
    return {
      result: 'unknown',
      message: `No profession expectation is defined for provider type "${providerType}".`,
    };
  }

  if (expected.some((allowed) => profession.includes(allowed) || allowed.includes(profession))) {
    return {
      result: 'consistent',
      message: `AHPRA records this practitioner as "${registerProfession}", which fits ${providerType}.`,
    };
  }

  return {
    result: 'mismatch',
    message:
      `AHPRA records this practitioner as "${registerProfession}", but this practice is affiliating them as ` +
      `${providerType}. NOT A BLOCK — profession names vary and scopes overlap — but if this is right, the ` +
      'provider type is wrong; and if the provider type is right, the registration number belongs to somebody ' +
      'else.',
  };
}

/** How the registration details were obtained. Recorded, never assumed. */
export const REGISTRATION_SOURCES = ['ahpra_manual', 'pie_api'] as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

/**
 * A manual sighting is a person's word about a public register, so it must
 * name them — exactly as the ABR attestation does.
 */
export function assertSightingAttributable(source: string, sightedByName?: string | null): void {
  if (source === 'ahpra_manual' && !sightedByName?.trim()) {
    throw new AhpraError(
      'REQ-PKI-01',
      'A manual AHPRA sighting must name the human who looked at the register. "Checked" with nobody ' +
        'attached is not a check.',
    );
  }
  if (!(REGISTRATION_SOURCES as readonly string[]).includes(source)) {
    throw new AhpraError('REQ-PKI-04', `"${source}" is not a known registration source.`);
  }
}
