/**
 * The application audit trail.
 *
 * Asked directly: "once I record the details, how can I go back and see what I
 * or someone else did?" Until this existed the answer was a one-line trail per
 * check with no date, no reason, no note and no evidence — enough to know
 * somebody had done something, not enough to know what.
 *
 * WHAT AN AUDIT TRAIL IS ACTUALLY FOR. Not reassurance. It is read in exactly
 * three situations, and each one wants something different:
 *
 *   1. A SECOND REVIEWER picking up an application somebody else started, who
 *      needs to know what has been done so they do not redo it or assume it.
 *   2. A DISPUTE, months or years later, where the question is not "was this
 *      approved" but "on what basis" — and the honest answer has to survive
 *      the departure of everyone involved.
 *   3. A REVIEWER CHECKING THEMSELVES, because the most common reason to look
 *      is that you cannot remember whether you already made the call.
 *
 * All three want the same thing: everything that happened, in order, with who
 * and when, and nothing quietly omitted. So this MERGES the separate
 * append-only records rather than presenting them as four tabs — a reviewer
 * should not have to correlate three lists by timestamp in their head to
 * discover that an applicant changed a phone number the day after it was
 * verified.
 *
 * NOTHING IS EVER EDITED OR REMOVED anywhere in this trail. A correction is a
 * further entry, and a reviewer changing their mind is itself part of the
 * record — arguably the most interesting part.
 */

export type AuditKind =
  | 'submitted'
  | 'email_verified'
  | 'correction_requested'
  | 'amended'
  | 'check'
  | 'evidence'
  | 'decision'
  | 'ceremony';

export interface AuditEntry {
  readonly kind: AuditKind;
  readonly at: string;
  /** The named human, or null where the actor is genuinely the system. */
  readonly who: string | null;
  /** One line, already resolved to human words by the caller. */
  readonly summary: string;
  /** Optional structured detail the UI renders as a definition list. */
  readonly detail?: Readonly<Record<string, string>>;
  /**
   * Whether this entry SUPERSEDES an earlier one — a later check on the same
   * key, or a later amendment of the same field. Computed rather than stored,
   * because it is a statement about the sequence, not about the entry.
   */
  readonly supersedes?: boolean;
  /**
   * For an evidence entry, the artefact to open. Null when the bytes have been
   * removed — the tombstone stays in the trail, because ceasing to hold a file
   * is not the same as it never having existed (REQ-OFF-07).
   */
  readonly artefactId?: string | null;
}

/**
 * Order the merged trail.
 *
 * OLDEST FIRST, which is the opposite of most activity feeds and is deliberate.
 * A feed answers "what happened lately"; an audit trail answers "how did this
 * get here", and that reads forwards. Reverse-chronological forces the reader
 * to reconstruct causation backwards, which is exactly where mistakes are made.
 *
 * Ties break by kind so that, within a single second, the thing that caused the
 * others comes first — an amendment before the checks it affected, a check
 * before the evidence attached to it.
 */
const KIND_ORDER: Record<AuditKind, number> = {
  submitted: 0,
  email_verified: 1,
  correction_requested: 2,
  amended: 3,
  check: 4,
  evidence: 5,
  ceremony: 6,
  decision: 7,
};

export function orderAuditTrail(entries: readonly AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const byTime = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (byTime !== 0) return byTime;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

/**
 * Mark entries that a later entry supersedes.
 *
 * A superseded entry is NOT hidden and must never be. The point of an
 * append-only record is that the earlier state remains readable; marking it
 * merely saves the reader from thinking a failed check is still standing when a
 * later pass replaced it.
 *
 * `subject` is what makes two entries the same thing: a check key, or an
 * amended field name. Entries with no subject supersede nothing.
 */
export function markSuperseded(
  entries: readonly (AuditEntry & { subject?: string })[],
): Array<AuditEntry & { subject?: string }> {
  const latest = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!entry.subject) return;
    const key = `${entry.kind}:${entry.subject}`;
    const previous = latest.get(key);
    if (previous === undefined || new Date(entries[previous].at) <= new Date(entry.at)) {
      latest.set(key, index);
    }
  });

  return entries.map((entry, index) => {
    if (!entry.subject) return entry;
    const key = `${entry.kind}:${entry.subject}`;
    return { ...entry, supersedes: latest.get(key) !== index ? true : undefined };
  });
}

/**
 * A short account of what the trail shows, for the top of the view.
 *
 * Counts, not prose — a reviewer glancing at this wants to know whether there
 * is anything here before deciding to read it.
 */
export function summariseAudit(entries: readonly AuditEntry[]): {
  checks: number;
  amendments: number;
  evidence: number;
  people: string[];
} {
  const people = new Set<string>();
  let checks = 0;
  let amendments = 0;
  let evidence = 0;

  for (const entry of entries) {
    if (entry.who) people.add(entry.who);
    if (entry.kind === 'check') checks += 1;
    if (entry.kind === 'amended') amendments += 1;
    if (entry.kind === 'evidence') evidence += 1;
  }

  return { checks, amendments, evidence, people: [...people].sort() };
}
