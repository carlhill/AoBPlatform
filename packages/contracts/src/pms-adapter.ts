/**
 * FR-9.1 — the PMS adapter interface. Every adapter (Medtech Evolution first)
 * implements this one contract; no PMS-specific concept leaks into the core
 * domain (C12.2, REQ-INT-03).
 *
 * D-01 (Medtech write-back mechanism) is UNRESOLVED. Until it is, the only
 * implementation is a mock behind this interface — do not guess Medtech's API
 * (CLAUDE.md §5). Core behaviour degrades explicitly per missing capability:
 * e.g. no claimEvents capability ⇒ the retention clock defaults conservatively
 * to service date + buffer and the record is flagged (REQ-INT-04).
 */
import type { IsoDate, PatientId } from '@aobplatform/domain';

/** Declared per adapter; the core adjusts behaviour to what is absent. */
export interface PmsAdapterCapabilities {
  readonly readPatient: boolean;
  readonly readAppointments: boolean;
  readonly readProviders: boolean;
  readonly readInvoices: boolean;
  readonly writeArtefact: boolean;
  readonly writeNote: boolean;
  /** Optional everywhere — claim observation is not guaranteed (REQ-INT-04). */
  readonly claimEvents: boolean;
}

export interface PmsPatientRecord {
  readonly pmsLinkageKey: string;
  readonly familyName: string;
  readonly givenNames: string;
  readonly dateOfBirth: string;
  readonly genderAsIdentified?: string;
  readonly address?: string;
  readonly patientRecordNumber?: string;
  readonly ihi?: string;
  readonly preferredLanguage?: string;
  readonly mobile?: string;
  readonly email?: string;
}

export interface PmsAppointment {
  readonly pmsAppointmentKey: string;
  readonly patientLinkageKey: string;
  readonly providerLinkageKey: string;
  readonly date: IsoDate;
  readonly time?: string;
}

export interface PmsProvider {
  readonly pmsProviderKey: string;
  readonly name: string;
  readonly providerNumber?: string;
  readonly locationAddress?: string;
}

export interface PmsInvoice {
  readonly pmsInvoiceKey: string;
  readonly patientLinkageKey: string;
  readonly providerLinkageKey: string;
  readonly serviceDate: IsoDate;
  readonly mbsItemNumbers: readonly string[];
}

export interface PmsClaimEvent {
  readonly pmsInvoiceKey: string;
  readonly lodgedDate: IsoDate;
}

export interface WriteArtefactRequest {
  readonly patientLinkageKey: string;
  /** PDF/A bytes of the signed, validated agreement — hashed before write (REQ-VAULT-02). */
  readonly artefact: Uint8Array;
  readonly artefactSha256: string;
  readonly filename: string;
  readonly description: string;
}

export interface WriteResult {
  /** Idempotent — writing the same artefact twice must not duplicate (FR-9.3). */
  readonly written: boolean;
  readonly pmsDocumentKey?: string;
}

/**
 * The adapter contract. Verification challenges match against PMS-held values
 * fetched at challenge time where possible (ADR A-08) — hence readPatient by
 * linkage key, not a bulk sync.
 */
export interface PmsAdapter {
  readonly pms: 'medtech_evolution' | 'mock' | string;
  readonly capabilities: PmsAdapterCapabilities;

  readPatient(pmsLinkageKey: string): Promise<PmsPatientRecord | null>;
  findPatient(query: { familyName?: string; dateOfBirth?: string; patientRecordNumber?: string }): Promise<
    readonly PmsPatientRecord[]
  >;
  readAppointments(date: IsoDate): Promise<readonly PmsAppointment[]>;
  readProviders(): Promise<readonly PmsProvider[]>;
  readInvoices(since: IsoDate): Promise<readonly PmsInvoice[]>;

  /** Write-back is the product (REQ-INT-02) — proven before anything else is built. */
  writeArtefact(request: WriteArtefactRequest): Promise<WriteResult>;
  writeNote(patientLinkageKey: string, note: string): Promise<WriteResult>;

  /** Only called when capabilities.claimEvents is true. */
  claimEvents?(since: IsoDate): Promise<readonly PmsClaimEvent[]>;
}

/** Marker for records whose retention clock had to be defaulted conservatively (REQ-INT-04). */
export interface RetentionClockSource {
  readonly source: 'observed_claim' | 'practice_asserted' | 'conservative_default';
  readonly anchorDate: IsoDate;
  readonly patientId?: PatientId;
}
