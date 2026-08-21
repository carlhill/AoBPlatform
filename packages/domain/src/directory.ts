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

// ---------------------------------------------------------------------------
// The practice's own roster
// ---------------------------------------------------------------------------

/**
 * What a practice may see about a practitioner IT HAS A RELATIONSHIP WITH.
 *
 * Distinct from `DirectoryEntry`, which answers a different question: what may
 * one practice see about a practitioner who is not theirs. That answer is
 * deliberately almost nothing. This one is larger, and the enlargement has to
 * be argued field by field rather than assumed from the relationship:
 *
 *   - REGISTRATION STATUS, PROFESSION, CONDITIONS — from the AHPRA public
 *     register, which anybody may search. Echoing what a regulator publishes
 *     costs nothing, and a practice that cannot see "Suspended" cannot act on
 *     it.
 *
 *   - WHO CHECKED THE REGISTER, AND WHEN — our own record of our own work. It
 *     is the difference between a claim and evidence, and it is the whole
 *     content of the practitioners card on the setup hub.
 *
 *   - THE EMAIL, BUT ONLY TO THE PRACTICE THAT SUPPLIED IT. A practitioner's
 *     address is theirs, not a shared contact record. The practice that
 *     pre-registered them typed it in and can reasonably see what it typed;
 *     a second practice affiliating the same person later has no claim on it
 *     and does not need one — invitations are sent by us, and inviting is
 *     keyed on the AHPRA number. So the second practice is told an address
 *     EXISTS, which is what it actually needs to know, and not what it is.
 *
 * WHAT IS STILL ABSENT, and must stay absent: the provider number, and any
 * hint of which other practices this person works at. Neither becomes
 * shareable because somebody employed them.
 */
export interface RosterEntry extends DirectoryEntry {
  /** Present ONLY to the practice that created this practitioner record. */
  readonly email?: string | null;
  /** Always present, so a practice can tell an invitation has somewhere to go. */
  readonly hasEmail: boolean;
  /** True when this practice pre-registered them, which is what unlocks `email`. */
  readonly invitedByThisPractice: boolean;

  // --- What the AHPRA public register says ---
  readonly registrationStatus?: string | null;
  readonly profession?: string | null;
  readonly division?: string | null;
  readonly conditions?: string | null;

  // --- Our record of checking it ---
  readonly registrationSightedByName?: string | null;
  readonly registrationSightedAt?: Date | null;
  readonly registrationSource?: string | null;
  /** The single fact the setup hub's practitioners card is about. */
  readonly registerChecked: boolean;

  /** REQ-XFER-08 — set means an immediate hard stop across every affiliation. */
  readonly deregisteredAt?: Date | null;
}

/**
 * Project a practitioner down to the roster shape.
 *
 * Field-by-field, never a spread — the same discipline as `toDirectoryEntry`
 * and for the same reason: a spread starts leaking any column added to the
 * practitioner table later, silently, and the column that eventually gets added
 * is the one that mattered.
 */
export function toRosterEntry(practitioner: PractitionerRecord, viewingPracticeId: string): RosterEntry {
  const invitedByThisPractice = practitioner.invitedByPracticeId === viewingPracticeId;
  return {
    ...toDirectoryEntry(practitioner),
    email: invitedByThisPractice ? ((practitioner.email as string | null) ?? null) : undefined,
    hasEmail: Boolean(practitioner.email),
    invitedByThisPractice,
    registrationStatus: (practitioner.registrationStatus as string | null) ?? null,
    profession: (practitioner.profession as string | null) ?? null,
    division: (practitioner.division as string | null) ?? null,
    conditions: (practitioner.conditions as string | null) ?? null,
    registrationSightedByName: (practitioner.registrationSightedByName as string | null) ?? null,
    registrationSightedAt: (practitioner.registrationSightedAt as Date | null) ?? null,
    registrationSource: (practitioner.registrationSource as string | null) ?? null,
    registerChecked: Boolean(practitioner.registrationSightedAt),
    deregisteredAt: (practitioner.deregisteredAt as Date | null) ?? null,
  };
}
