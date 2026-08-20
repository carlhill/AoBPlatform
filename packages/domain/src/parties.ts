/**
 * The four first-class parties (functional requirements, M1), modelled per
 * Addendum v3 §7.3. Terminology per CLAUDE.md §3: "provider" not "GP",
 * "service" not "consult". Assignor and Patient are DISTINCT roles even when
 * the same human fills both — never conflate them (design decisions §7).
 *
 * Data rule: "cache the person, snapshot the agreement" (REQ-DATA-10/-11).
 * The PMS is the source of truth for who the patient is; the agreement
 * snapshots what was true at signature time.
 */
import type { AssignorId, OrganisationId, PatientId, PracticeId, ProviderId } from './ids';

/** Drives Basic Service Description categories and the enduring GP-only rule (REQ-END-01a). */
export type ProviderType =
  | 'general_practitioner'
  | 'specialist'
  | 'allied_health'
  | 'nurse_practitioner'
  | 'optometrist'
  | 'other';

export interface Provider {
  readonly id: ProviderId;
  readonly practiceId: PracticeId;
  name: string;
  providerType: ProviderType;
  /** s 65C(5): EITHER name+address OR provider number satisfies D4. A provider number is NOT mandatory (REQ-REG-02). */
  placeOfPracticeAddress?: string;
  /** Per place of practice — a provider has one per location. Optional by design. */
  providerNumber?: string;
  ahpraRegistrationNumber?: string;
  active: boolean;
}

/**
 * Minimum patient record (design decisions §6.3). Explicitly NOT held: the
 * Medicare card number (HARD-03), clinical data, diagnoses, notes.
 */
export interface Patient {
  readonly id: PatientId;
  familyName: string;
  givenNames: string;
  /** Mandatory — age rules and the 14th-birthday cessation job cannot run without it (REQ-DATA-01). */
  dateOfBirth: string;
  genderAsIdentified?: string;
  address?: string;
  patientRecordNumber?: string;
  ihi?: string;
  preferredLanguage?: string;
  mobile?: string;
  email?: string;
  /** REQ-CHILD-01: once set, removable only by the patient or a clinician. Fail closed (REQ-CHILD-07). */
  confidentialityFlag: boolean;
  myMedicareRegistered?: boolean;
  residentialAgedCareFacilityId?: string;
  acchoOrganisationId?: OrganisationId;
  /** Linkage key back to the PMS record — the PMS stays the source of truth. */
  pmsLinkageKey?: string;
}

/** Authority basis for an assignor acting for another person (REQ-VUL-01, self-declared per reg 65CB(5)). */
export type AssignorAuthorityBasis =
  | 'self' // the patient is the assignor
  | 'parent'
  | 'spouse'
  | 'co_resident_relative_18_plus'
  | 'guardian'
  | 'health_epoa'
  | 'other_with_note';

/**
 * An assignor is a person, not a field on the patient (Addendum v3 §7.3).
 * One assignor may act for many patients; one patient may have many assignors.
 * Modelled separately from Patient even when they are the same human.
 */
export interface Assignor {
  readonly id: AssignorId;
  name: string;
  /** Needed for the 18+ rule (REQ-AGE-01). Never self-attested where DOB is held (REQ-AGE-04). */
  dateOfBirth?: string;
  relationshipToPatient?: string;
  authorityBasis: AssignorAuthorityBasis;
  authorityNote?: string;
  contactMobile?: string;
  contactEmail?: string;
  preferredLanguage?: string;
}

export interface Practice {
  readonly id: PracticeId;
  name: string;
  abn?: string;
  /** Each location carries an address — s 65C(5)(a) depends on it (FR-1.1). */
  locations: PracticeLocation[];
  pms: 'medtech_evolution' | 'other';
  rails: Array<'tyro' | 'hicaps'>;
}

export interface PracticeLocation {
  readonly id: string;
  address: string;
}

/** ACCHO/AMS organisation — the enduring anchor on that pathway (Addendum v3 §1.1). */
export interface Organisation {
  readonly id: OrganisationId;
  name: string;
  abn?: string;
  /** Reg 65CB: the agreement records the authorised agent's name and address/provider number. */
  authorisedAgentName?: string;
  authorisedAgentAddressOrProviderNumber?: string;
}
