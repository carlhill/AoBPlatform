/**
 * Priority lanes for work arriving FROM a practice — CONSULTATION-CAPTURE-PLAN.md
 * Part 9.
 *
 * Carl's rule, and it is the right one: a new agreement the patient must
 * approve is critical — it has to be on the tablet while the patient is
 * talking to the person at the front desk. The post-consultation approval is
 * equally critical for a blunter reason: without it the practice does not get
 * paid, and the twelve-month lodgement window is running. The morning
 * appointment list is neither — it pre-stages the day, hours ahead.
 *
 * ONE FIFO QUEUE IS THE FAILURE. The morning list is hundreds of rows, printed
 * by every practice at once, and it would sit in front of the one arrival slip
 * for the patient at the desk. So: lanes, declared here as data — the way
 * REVIEW_TASK_KINDS declares stakes — so no document type is urgent by
 * accident and a new type must say which lane it is on.
 */

export const INBOUND_LANES = ['critical', 'standard', 'fyi'] as const;
export type InboundLane = (typeof INBOUND_LANES)[number];

/**
 * What each lane promises, and how often its worker looks.
 *
 * `sloSeconds` is the target from a job being received to its consequences
 * existing (a draft on the kiosk, a link queued). `pollMs` is the worker's
 * cadence: the critical lane polls every second, which puts the worker hop
 * well inside a five-second SLO. LISTEN/NOTIFY would make that milliseconds
 * and is the recorded upgrade — it needs a raw `pg` connection, which is a
 * dependency this codebase does not carry yet.
 *
 * "FYI" IS A SPEED, NOT A LICENCE TO DROP. It has an SLO too.
 */
export const LANE_POLICIES: Record<InboundLane, { readonly sloSeconds: number; readonly pollMs: number; readonly batch: number }> = {
  critical: { sloSeconds: 5, pollMs: 1_000, batch: 25 },
  standard: { sloSeconds: 60 * 60, pollMs: 15_000, batch: 50 },
  fyi: { sloSeconds: 6 * 60 * 60, pollMs: 60_000, batch: 50 },
};

/**
 * The documents a practice's desktop can print to us (Part 8), each on its
 * lane. Adding a document type without a lane is a compile error, which is
 * the point.
 */
export const PRINT_DOCUMENT_TYPES = ['arrival_slip', 'invoice', 'appointment_list'] as const;
export type PrintDocumentType = (typeof PRINT_DOCUMENT_TYPES)[number];

export const PRINT_DOCUMENT_LANES: Record<PrintDocumentType, InboundLane> = {
  /** One patient, at the desk, now. */
  arrival_slip: 'critical',
  /** No approval, no payment; the window is running. */
  invoice: 'critical',
  /** The whole day, hours before anybody arrives. */
  appointment_list: 'standard',
};

export function laneFor(documentType: PrintDocumentType): InboundLane {
  return PRINT_DOCUMENT_LANES[documentType];
}

export function isPrintDocumentType(value: string): value is PrintDocumentType {
  return (PRINT_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** The same states as the outbound queue, for the same reasons (outbound-queue.ts). */
export const INBOUND_STATES = ['pending', 'leased', 'done', 'failed', 'dead'] as const;
export type InboundState = (typeof INBOUND_STATES)[number];
