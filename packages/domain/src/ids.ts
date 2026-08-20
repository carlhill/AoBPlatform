/**
 * Branded ID types. Passing the wrong kind of ID is a compile error, not a
 * runtime bug. (Pattern carried over from ReferralPlatform shared-types.)
 */
declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type PracticeId = Branded<string, 'PracticeId'>;
export type ProviderId = Branded<string, 'ProviderId'>;
export type OrganisationId = Branded<string, 'OrganisationId'>;
export type PatientId = Branded<string, 'PatientId'>;
export type AssignorId = Branded<string, 'AssignorId'>;
export type AgreementId = Branded<string, 'AgreementId'>;
export type CaptureRequestId = Branded<string, 'CaptureRequestId'>;
export type VerificationEventId = Branded<string, 'VerificationEventId'>;
export type SignatureEventId = Branded<string, 'SignatureEventId'>;
export type VaultEventId = Branded<string, 'VaultEventId'>;
export type NoticeId = Branded<string, 'NoticeId'>;
export type NominationId = Branded<string, 'NominationId'>;
export type TreatmentPlanId = Branded<string, 'TreatmentPlanId'>;

/** ISO-8601 UTC timestamp string (server-authoritative time — REQ-VAULT-03). */
export type IsoTimestamp = Branded<string, 'IsoTimestamp'>;
/** Calendar date, `YYYY-MM-DD`, in the practice's timezone. */
export type IsoDate = Branded<string, 'IsoDate'>;
