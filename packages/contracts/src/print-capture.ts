/**
 * What a practice's desktop sends us when the PMS prints — CONSULTATION-CAPTURE-PLAN.md
 * Part 8, the print channel.
 *
 * THE PAYLOAD IS THE CONTRACT. The AoBPrinterApp parses the print job on the
 * desktop (8.2) and ships ONLY the s 65C fields, shaped as the very same
 * records the PMS adapter interface already speaks — `PmsPatientRecord`,
 * `PmsProvider`, `PmsAppointment`, `PmsInvoice`. So the core never learns a
 * new shape for "a patient" or "an invoice" because the data arrived by
 * print rather than by API, and the adapter contract stays the seam without
 * a per-practice adapter object standing between the queue and the cascade.
 *
 * WHAT IS DELIBERATELY ABSENT: the document. No PDF, no text, no image. A
 * print job can carry a Medicare number, a dollar amount, clinical notes if
 * somebody printed the wrong thing — and none of it may reach us. The hash
 * below is how a dispute can still prove "this record came from exactly that
 * document" without the document ever having been stored.
 */
import type { IsoTimestamp, PrintDocumentType } from '@aobplatform/domain';
import type { PmsAppointment, PmsInvoice, PmsPatientRecord, PmsProvider } from './pms-adapter';

export interface PrintJobEnvelope {
  readonly documentType: PrintDocumentType;
  /** SHA-256 (hex) of the source print job. Provenance without possession. */
  readonly sourceSha256: string;
  /** Which downloaded parser template produced these fields (8.2) — PMS-specific, versioned. */
  readonly parserTemplateVersion: string;
  /** The PMS the template was written for. Recorded, never interpreted here. */
  readonly pms: string;
  /** When the desktop captured the job, by its clock. */
  readonly capturedAt: IsoTimestamp;

  /** The people and providers the document named, so they can be mirrored without a PMS read. */
  readonly patients?: readonly PmsPatientRecord[];
  readonly providers?: readonly PmsProvider[];
  /** arrival_slip: one; appointment_list: the day. */
  readonly appointments?: readonly PmsAppointment[];
  /** invoice: usually one. */
  readonly invoices?: readonly PmsInvoice[];
}

/** What the platform says back — at once, before any of it is processed. */
export interface PrintJobAccepted {
  readonly id: string;
  readonly lane: 'critical' | 'standard' | 'fyi';
  /** True when this exact document (same type, same hash) was already received. Not an error. */
  readonly duplicate: boolean;
  readonly receivedAt: IsoTimestamp;
}
