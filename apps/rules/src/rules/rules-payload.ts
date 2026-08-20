/**
 * The shape the s 65C validator inspects — the input contract for rule
 * evaluation (REQ-65C-01). This is deliberately a superset of the rendered
 * particulars: rules C9/C12/C13 need signature, lock and verification
 * metadata, not only the D1–D7 data set.
 *
 * ZERO PII discipline (ADR A-07): callers send the particulars needed for
 * validation; nothing here is persisted by this service and nothing is logged
 * with values.
 */
export interface ValidationPayload {
  /** D1 */
  patientName?: string;
  /** D2 — ISO date the agreement is proposed to be entered into. */
  agreementDate?: string;
  /** D3 — explicit, never inferred. */
  agreementType?: 'episodic_pre' | 'episodic_post' | 'treatment_plan' | 'enduring';
  /** D4 — either name+address or provider number satisfies s 65C(5). */
  providerName?: string;
  providerAddress?: string;
  providerNumber?: string;
  /** D5 */
  serviceDate?: string;
  /** D6a — pre-agreements: from the current Basic Service Description mapping. */
  basicServiceDescription?: string;
  /** D6b — post-agreements: at least one valid MBS item number. */
  mbsItemNumbers?: string[];
  /** D7 + conditional assignor details. */
  assignorIsPatient?: boolean;
  assignorName?: string;
  assignorRelationship?: string;

  /** C9 — signature presence and capture method. */
  signaturePresent?: boolean;
  signatureMethod?: 'drawn' | 'tap_to_approve' | 'typed_name' | 'wet_ink_scan' | 'verbal_recorded';
  signatureTimestamp?: string;

  /** C12 — particulars lock time; must precede the signature timestamp. */
  particularsLockedAt?: string;

  /** C13 — verification event (types/outcomes only upstream; here just the fact). */
  verificationPassed?: boolean;

  /** C14 — claim lodgement time where observable; absent means unobservable. */
  claimLodgedAt?: string;

  /**
   * Unknown/extra fields are how C10 (practitioner signature) and C11
   * (benefit amount) defects arrive — the validator must inspect the raw
   * payload, not only the typed fields.
   */
  [key: string]: unknown;
}
