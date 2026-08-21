/**
 * The practitioner directory — what one practice may see about a practitioner
 * who is not (yet) theirs.
 *
 * THE RULE: the directory exposes the AHPRA registration number and never the
 * Medicare provider number.
 *
 * AHPRA registration is national and genuinely public — AHPRA itself publishes
 * a searchable register carrying name, profession, registration status and
 * conditions. Echoing a number that is already public costs nothing.
 *
 * The Medicare provider number is NOT public, and is the exact artefact the
 * REQ-PKI family exists to protect (Addendum v5 PART C cites a $7.5m
 * prosecution turning on impersonation of twenty doctors). A directory that
 * hands provider numbers to anyone who can type a name is a fraud tool.
 *
 * Search is EXACT-MATCH ON THE AHPRA NUMBER, not fuzzy name browse. Even
 * against a public register, letting any admin enumerate every practitioner on
 * the platform tells an attacker who our customers are.
 */

import { isValidAhpraNumberFormat } from './enrolment-ceremony';

export class DirectoryError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'DirectoryError';
  }
}

/**
 * The ONLY shape in which a practitioner crosses a practice boundary.
 *
 * Note what has no field here: providerNumber, email, date of birth, address,
 * and the list of other practices they work at. A type cannot leak a column it
 * does not have.
 */
export interface DirectoryEntry {
  readonly practitionerId: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly ahpraNumber: string;
  readonly providerType: string;
  /** Whether they have completed a REQ-PKI-01 ceremony — not WHO attested it. */
  readonly verified: boolean;
}

/** Everything the platform holds about a practitioner. Never returned as-is. */
export interface PractitionerRecord {
  readonly id: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly ahpraNumber: string;
  readonly providerType: string;
  readonly email?: string | null;
  readonly verifiedAt?: Date | null;
  readonly [extra: string]: unknown;
}

/**
 * Project a practitioner down to the directory shape. Explicit field-by-field
 * construction, never a spread — a spread would silently start leaking any
 * column added to the practitioner table later.
 */
export function toDirectoryEntry(practitioner: PractitionerRecord): DirectoryEntry {
  return {
    practitionerId: practitioner.id,
    familyName: practitioner.familyName,
    givenNames: practitioner.givenNames,
    ahpraNumber: practitioner.ahpraNumber,
    providerType: practitioner.providerType,
    verified: Boolean(practitioner.verifiedAt),
  };
}

/**
 * Directory lookup takes an AHPRA number and nothing else. Rejecting a name
 * search is a feature: it is the difference between "confirm this specific
 * practitioner" and "list every doctor you have".
 */
export function assertDirectoryQueryAllowed(query: string): string {
  const normalised = query.trim().toUpperCase();
  if (!isValidAhpraNumberFormat(normalised)) {
    throw new DirectoryError(
      'REQ-PKI-03',
      'The practitioner directory is searched by AHPRA registration number only (e.g. MED0001234567). ' +
        'Name search is not offered — it would let any practice enumerate every practitioner on the platform. ' +
        'Ask the practitioner for their AHPRA number; it is on their AHPRA registration certificate.',
    );
  }
  return normalised;
}

/**
 * A guard for the boundary: refuses to serialise anything carrying a provider
 * number. Cheap, and it turns a future copy-paste mistake into a test failure
 * instead of a disclosure.
 */
export function assertNoProviderNumber(payload: unknown, context: string): void {
  const serialised = JSON.stringify(payload ?? null);
  if (/"provider_?[Nn]umber"/.test(serialised)) {
    throw new DirectoryError(
      'REQ-PKI-03',
      `${context} carries a provider number. Provider numbers never cross a practice boundary — ` +
        'they are the artefact impersonation fraud needs.',
    );
  }
}
