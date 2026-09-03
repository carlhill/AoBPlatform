/**
 * One log, two audiences — the design handoff's M-1 and the Messages tab of P-1.
 *
 * "M-1 and the Messages tab of P-1 are the same dispatch records rendered for
 * different readers. Build them off one query and one string table, not two
 * features." So the shaping lives here, once, and the three screens differ
 * only in which audience they pass.
 *
 * WHAT THIS FILE DECIDES:
 *
 *   1. WHAT A MESSAGE WAS FOR. The correspondence table records what a message
 *      was ABOUT (`subjectType`) rather than why it was sent, so the purpose is
 *      derived: the first message about an agreement is the capture link, every
 *      one after it is a chase, a Notice row is an 89AA notice. Derived in one
 *      place because two screens deriving it separately is how they come to
 *      disagree about what a row is.
 *   2. WHETHER IT MAY BE CHASED. 89AA notices are one-way (CLAUDE.md rule 7,
 *      REQ-END-05/REQ-CHASE-02): no resend action, ever, on any surface. The
 *      screens ask this function rather than each carrying the rule.
 *   3. WHAT EACH READER MAY SEE. Cost is the practice's business and never the
 *      patient's; bodies belong to the practice that sent and the patient who
 *      received, and the platform twin sees states, never bodies.
 *   4. A SUPPRESSED SEND IS A ROW. "A confidential visit is suppressed before a
 *      message exists, not filtered afterwards" — so it is merged in as an
 *      entry that says so, never a row quietly missing from the list.
 */

export const CORRESPONDENCE_PURPOSES = ['capture', 'reminder', 'copy', 'notice', 'practice'] as const;
export type CorrespondencePurpose = (typeof CORRESPONDENCE_PURPOSES)[number];

/** Who is reading. Decides bodies and cost, nothing else. */
export const LOG_AUDIENCES = ['practice', 'platform', 'practitioner', 'patient'] as const;
export type LogAudience = (typeof LOG_AUDIENCES)[number];

/** A projection of the transport's states, plus the one that never had a transport. */
export type LogState = 'queued' | 'sent' | 'delivered' | 'failed' | 'dead' | 'suppressed';

/** One correspondence row, as much of it as the log needs. */
export interface DispatchRow {
  id: string;
  subjectType: string;
  /** 1 for the first message about an agreement, 2+ for each chase after it. */
  attempt?: number | null;
  channel: string;
  state: string;
  queuedAt: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  recipientName?: string | null;
  to?: string | null;
  subject?: string | null;
  contentRemovedAt?: string | null;
}

/**
 * A send that never happened, and why. Only the confidentiality flag reaches
 * this log: the other suppression reasons ("under 14", "no way to reach") are
 * things a person still has to act on, and they belong on the reconciliation
 * queue where there is an action beside them.
 */
export const SUPPRESSIONS_SHOWN_ON_LOG: readonly string[] = ['confidentiality_flag'];

export interface SuppressedSend {
  serviceRecordId: string;
  patientName: string | null;
  reason: string;
  suppressedAt: string;
}

export interface LogEntry {
  id: string;
  kind: 'dispatch' | 'suppressed';
  purpose: CorrespondencePurpose;
  /** Which chase this was, for a reminder. Null for everything else. */
  attempt: number | null;
  /** The patient, the practice or the practitioner — whoever the reader needs named. */
  who: string | null;
  to: string | null;
  channel: string | null;
  at: string | null;
  state: LogState;
  failureReason: string | null;
  /** False on an 89AA notice, always. Rule 7. */
  chaseable: boolean;
  /** The retention sweep took the text. The row stays and says so — never a blank. */
  contentRemoved: boolean;
  /** Why no message exists, for a suppressed entry. */
  suppressionReason: string | null;
  subject: string | null;
}

/** What a message was for, from what it was about. */
export function purposeOf(row: Pick<DispatchRow, 'subjectType' | 'attempt'>): CorrespondencePurpose {
  if (row.subjectType === 'Notice') return 'notice';
  if (row.subjectType === 'Agreement') return 'copy';
  if (row.subjectType === 'CaptureRequest') return (row.attempt ?? 1) > 1 ? 'reminder' : 'capture';
  return 'practice';
}

/**
 * May this be chased?
 *
 * NO, on an 89AA notice, and there is no configuration that changes it. A
 * notice tells a patient a service was billed under an enduring agreement; it
 * asks for nothing, so there is nothing to chase, and a resend button beside
 * one would imply a response was expected. (CLAUDE.md rule 7.)
 */
export function mayChase(purpose: CorrespondencePurpose): boolean {
  return purpose !== 'notice';
}

/** Per-message cost is the practice's own business. Never the patient's. */
export function showsCost(audience: LogAudience): boolean {
  return audience === 'practice';
}

/**
 * Bodies belong to the practice that sent and the person who received. The
 * platform twin shows states, never bodies (TODO.md, "a platform-wide view of
 * messages — states, not bodies").
 */
export function showsBodies(audience: LogAudience): boolean {
  return audience !== 'platform';
}

function stateOf(row: DispatchRow): LogState {
  switch (row.state) {
    case 'delivered':
    case 'sent':
    case 'failed':
    case 'dead':
      return row.state;
    default:
      return 'queued';
  }
}

/** The moment the reader means by "when": when it went, else when it was queued. */
function whenOf(row: DispatchRow): string {
  return row.sentAt ?? row.deliveredAt ?? row.failedAt ?? row.queuedAt;
}

/**
 * The log, from the dispatches that happened and the sends that were
 * suppressed before they could. Newest first, which is the order both screens
 * are drawn in.
 */
export function buildMessageLog(input: {
  dispatches: readonly DispatchRow[];
  suppressed?: readonly SuppressedSend[];
}): LogEntry[] {
  const entries: LogEntry[] = input.dispatches.map((row) => {
    const purpose = purposeOf(row);
    return {
      id: row.id,
      kind: 'dispatch' as const,
      purpose,
      attempt: purpose === 'reminder' ? (row.attempt ?? null) : null,
      who: row.recipientName ?? null,
      to: row.to ?? null,
      channel: row.channel,
      at: whenOf(row),
      state: stateOf(row),
      failureReason: row.failureReason ?? null,
      chaseable: mayChase(purpose),
      contentRemoved: Boolean(row.contentRemovedAt),
      suppressionReason: null,
      subject: row.subject ?? null,
    };
  });

  for (const s of input.suppressed ?? []) {
    if (!SUPPRESSIONS_SHOWN_ON_LOG.includes(s.reason)) continue;
    entries.push({
      id: `suppressed:${s.serviceRecordId}`,
      kind: 'suppressed',
      purpose: 'capture',
      attempt: null,
      who: s.patientName,
      to: null,
      channel: null,
      at: s.suppressedAt,
      state: 'suppressed',
      failureReason: null,
      // Nothing was sent, so there is nothing to send again.
      chaseable: false,
      contentRemoved: false,
      suppressionReason: s.reason,
      subject: null,
    });
  }

  return entries.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

/** The filter segment the design draws above the table. */
export const LOG_SEGMENTS = ['all', 'capture', 'reminder', 'copy', 'notice', 'failed'] as const;
export type LogSegment = (typeof LOG_SEGMENTS)[number];

export function matchesSegment(entry: LogEntry, segment: LogSegment): boolean {
  if (segment === 'all') return true;
  if (segment === 'failed') return entry.state === 'failed' || entry.state === 'dead';
  return entry.purpose === segment;
}
