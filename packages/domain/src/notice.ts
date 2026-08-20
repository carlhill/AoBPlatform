/**
 * Reg 89AA post-claim notices (REQ-END-05, REQ-DEL-01..09).
 *
 * THE THING TO UNDERSTAND FIRST: this notice is ONE-WAY. It goes out AFTER
 * the claim is lodged. Nothing is being approved; non-response has zero
 * effect on payment (design decisions §1). So it is never chased
 * (REQ-CHASE-02), never carries approval semantics in copy or UI, and a
 * delivery failure is a COMPLIANCE exposure, never a revenue one.
 *
 * It is also the ONE place in the entire product where a benefit amount
 * appears (CLAUDE.md rule 4). Agreements never carry one; notices must.
 */

/** The four mandatory elements (reg 89AA, Addendum v2 §4 quoting p.37). */
export interface NoticeContent {
  /** Name of the professional who provided the service. */
  readonly practitionerName: string;
  readonly patientName: string;
  readonly serviceDate: string;
  /** In cents. The one lawful benefit amount in the system — see the file header. */
  readonly benefitAmountCents: number;
}

export function assertNoticeContentComplete(content: Partial<NoticeContent>): asserts content is NoticeContent {
  const missing: string[] = [];
  if (!content.practitionerName?.trim()) missing.push('practitionerName');
  if (!content.patientName?.trim()) missing.push('patientName');
  if (!content.serviceDate?.trim()) missing.push('serviceDate');
  if (typeof content.benefitAmountCents !== 'number' || Number.isNaN(content.benefitAmountCents)) {
    missing.push('benefitAmountCents');
  }
  if (missing.length > 0) {
    throw new NoticeContentError(
      `Reg 89AA requires all four elements; missing: ${missing.join(', ')}. The obligation was not correctly formed.`,
    );
  }
}

export class NoticeContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoticeContentError';
  }
}

export class MethodFidelityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MethodFidelityError';
  }
}

/**
 * REQ-DEL-02 — METHOD FIDELITY. Reg 89AA requires the method NAMED IN THE
 * AGREEMENT. If the agreement says email and the practice sends SMS, that is
 * a breach even if it arrives. Validated at compose time; a mismatch blocks.
 */
export function assertMethodFidelity(agreementMethod: string, dispatchChannel: string): void {
  if (agreementMethod !== dispatchChannel) {
    throw new MethodFidelityError(
      `REQ-DEL-02: the agreement names "${agreementMethod}" as the notification method; ` +
        `dispatching by "${dispatchChannel}" breaches reg 89AA even if it arrives.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The five delivery states (Addendum v3 §2.1, REQ-DEL-01)
// ---------------------------------------------------------------------------

/**
 * Each state is independently evidenced with its own timestamp. NEVER
 * collapse these to a single `sent` boolean — a practice that cannot evidence
 * delivery cannot answer an auditor.
 */
export const NOTICE_DELIVERY_STATES = ['composed', 'dispatched', 'delivered', 'read', 'failed'] as const;
export type NoticeDeliveryState = (typeof NOTICE_DELIVERY_STATES)[number];

/**
 * REQ-DEL-07 — read state is EVIDENTIAL COLOUR, NEVER A COMPLIANCE MEASURE.
 * Open tracking is unreliable by design (image blocking, privacy proxies,
 * Apple Mail Privacy Protection) and SMS has no read receipt at all. The
 * obligation is to SEND, not to be READ. A dashboard scoring compliance on
 * read rates would report a fully compliant system as failing.
 */
export const COMPLIANCE_BEARING_STATES: readonly NoticeDeliveryState[] = ['composed', 'dispatched', 'delivered'];

export function isComplianceBearing(state: NoticeDeliveryState): boolean {
  return COMPLIANCE_BEARING_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// The 24-hour clock (REQ-END-05, REQ-DEL-03)
// ---------------------------------------------------------------------------

export const NOTICE_WINDOW_HOURS = 24;
/** Escalate before the window closes, not after (REQ-DEL-03). */
export const NOTICE_ESCALATION_HOURS = [12, 18] as const;

/** The clock starts at CLAIM LODGEMENT, not at the service (reg 89AA). */
export function noticeDeadline(claimLodgedAt: Date): Date {
  return new Date(claimLodgedAt.getTime() + NOTICE_WINDOW_HOURS * 3600_000);
}

export function hoursElapsedSinceClaim(claimLodgedAt: Date, now: Date = new Date()): number {
  return (now.getTime() - claimLodgedAt.getTime()) / 3600_000;
}

/** Highest escalation threshold passed, or null. Timezone-safe: everything is absolute time. */
export function escalationLevel(claimLodgedAt: Date, now: Date = new Date()): number | null {
  const elapsed = hoursElapsedSinceClaim(claimLodgedAt, now);
  let level: number | null = null;
  for (const threshold of NOTICE_ESCALATION_HOURS) {
    if (elapsed >= threshold) level = threshold;
  }
  return level;
}

export function isWithinNoticeWindow(claimLodgedAt: Date, at: Date = new Date()): boolean {
  return at.getTime() <= noticeDeadline(claimLodgedAt).getTime();
}

/**
 * Whether the obligation was discharged on time: DISPATCHED within the
 * window. Note what this does not consider — read state (REQ-DEL-07), and
 * whether the assignor responded (they never need to).
 */
export function dispatchedWithinWindow(claimLodgedAt: Date, dispatchedAt: Date | null): boolean {
  return dispatchedAt !== null && isWithinNoticeWindow(claimLodgedAt, dispatchedAt);
}
