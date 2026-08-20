/**
 * The Agreement — the centre of the data model (design decisions §7).
 *
 *     PROVIDER  ←──── AoB AGREEMENT ────→  ASSIGNOR
 *     (immutable)      (status)            (may be the patient)
 *                          │
 *                          └────────→  PATIENT (always named)
 *
 * Invariants encoded here:
 *  - HARD-01: the anchor (provider or organisation) is immutable — every anchor
 *    field is readonly and the lifecycle reducer rejects any change (see
 *    lifecycle.ts). Changing provider = terminate + recreate, never edit.
 *  - HARD-02: the rendered content is immutable once signed — corrections
 *    create a superseding agreement linked via `supersedesAgreementId`.
 *  - Rule 3 (CLAUDE.md): there is NO practitioner-signature field, anywhere.
 *  - Rule 4 (CLAUDE.md): there is NO benefit/dollar amount field on any
 *    agreement artefact (REQ-REG-04).
 *  - Rule 6: enduring anchors are polymorphic — provider for MyMedicare and
 *    aged care, organisation for ACCHO/AMS (Addendum v3 §1.1).
 *  - D7: `assignorIsPatient` is an explicit field, never inferred (s 65C(6)(b)).
 *  - Rule 14: every agreement records the rule-set version and Basic Service
 *    Description mapping version that validated it (REQ-65C-02, REQ-REG-03).
 */
import type {
  AgreementId,
  AssignorId,
  IsoDate,
  IsoTimestamp,
  OrganisationId,
  PatientId,
  PracticeId,
  ProviderId,
  SignatureEventId,
  TreatmentPlanId,
  VerificationEventId,
} from './ids';

export type AgreementType =
  | 'episodic_pre' // s 65C(4) item 5 — basic service description, before the service
  | 'episodic_post' // s 65C(4) item 6 — MBS item number(s), after the service
  | 'treatment_plan' // 6-month multi-service episodic pre-agreement (REQ-PLAN-*)
  | 'enduring'; // reg 65CA/65CB — GP-only, per provider × patient (REQ-END-01/-01a)

export type EnduringPathway = 'mymedicare' | 'residential_aged_care' | 'accho_ams';

/**
 * Polymorphic anchor (Addendum v3 §1.1): provider for episodic and for
 * MyMedicare / aged-care enduring; organisation ONLY for the ACCHO/AMS
 * enduring pathway. All fields readonly — HARD-01.
 */
export type AgreementAnchor =
  | { readonly kind: 'provider'; readonly providerId: ProviderId }
  | { readonly kind: 'organisation'; readonly organisationId: OrganisationId };

/** REQ-REC-02 + design decisions §7, incl. enduring registration states. */
export type AgreementStatus =
  | 'draft'
  | 'verification_pending'
  | 'verification_failed'
  | 'awaiting_signature'
  | 'signed'
  | 'validated'
  | 'stored'
  | 'active'
  | 'claim_linked'
  | 'declined'
  | 'expired'
  | 'verbal_recorded'
  | 'void' // treatment-plan occurrence break (REQ-PLAN-03)
  | 'ceased'
  | 'legal_hold'
  | 'retention_expiry_scheduled'
  // enduring only:
  | 'registration_pending'
  | 'registered'
  | 'registration_overdue';

/**
 * The s 65C(4) data set D1–D7, snapshotted onto the agreement at signature
 * time (REQ-DATA-11). Note what is absent, deliberately: no benefit amount,
 * no Medicare number, no practitioner signature.
 */
export interface AgreementParticulars {
  /** D1 — the patient, not necessarily the assignor. */
  readonly patientName: string;
  /** D2 — date the agreement is proposed to be entered into (not the service date). */
  readonly agreementDate: IsoDate;
  /** D3 — drives which of D5/D6 applies. */
  readonly type: AgreementType;
  /** D4 — s 65C(5)(a) name + address, or (b) provider number. Either satisfies. */
  readonly providerIdentifyingDetails:
    | { readonly kind: 'name_and_address'; readonly name: string; readonly address: string }
    | { readonly kind: 'provider_number'; readonly providerNumber: string };
  /** D5 — date the service will be (pre) or was (post) rendered. */
  readonly serviceDate: IsoDate;
  /** D6a — pre-agreements only: basic description from the current mapping version. */
  readonly basicServiceDescription?: string;
  /** D6b — post-agreements only: MBS item number(s). */
  readonly mbsItemNumbers?: readonly string[];
  /** D7 — explicit, never inferred (s 65C(6)(b)). */
  readonly assignorIsPatient: boolean;
  /** Required when assignorIsPatient is false. */
  readonly assignorName?: string;
  readonly assignorRelationship?: string;
}

export interface Agreement {
  readonly id: AgreementId;
  readonly type: AgreementType;
  /** HARD-01 — immutable. Terminate + recreate to change; no update path exists. */
  readonly anchor: AgreementAnchor;
  readonly practiceId: PracticeId;
  readonly patientId: PatientId;
  readonly assignorId: AssignorId;
  readonly assignorIsPatient: boolean;
  /** Enduring only. */
  readonly enduringPathway?: EnduringPathway;
  /** Treatment-plan agreements group occurrences under one plan (REQ-PLAN-01). */
  readonly treatmentPlanId?: TreatmentPlanId;

  status: AgreementStatus;

  /** Locked before the signature control can enable (REQ-REG-06, HARD-05). */
  particulars?: AgreementParticulars;
  particularsLockedAt?: IsoTimestamp;

  /** Rule 14 / REQ-65C-02: versions recorded on every stored agreement. */
  ruleSetVersion?: string;
  mappingVersion?: string;

  /** Language(s) the artefact was rendered in — bilingual by default (REQ-LANG-02). */
  renderedLanguages?: readonly string[];
  /** SHA-256 of the exact rendered PDF/A artefact, written before signature enables (REQ-VAULT-02). */
  renderedArtefactHash?: string;

  verificationEventId?: VerificationEventId;
  signatureEventId?: SignatureEventId;

  /** HARD-02: corrections supersede, never rewrite. */
  supersedesAgreementId?: AgreementId;

  /** Retention runs 2 years from the related claim (REQ-REG-09, REQ-INT-04) — parameterised, never hardcoded. */
  retentionExpiryDate?: IsoDate;
  legalHold: boolean;
}
