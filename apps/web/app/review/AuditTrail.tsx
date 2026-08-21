'use client';

/**
 * Everything that has happened to one application.
 *
 * Asked directly: "once I record the details, how can I go back and see what I
 * or someone else did?"
 *
 * READS FORWARDS, oldest first — the opposite of an activity feed, and
 * deliberate. A feed answers "what happened lately"; this answers "how did this
 * get here", and causation reads forwards. Reverse-chronological makes a reader
 * reconstruct the sequence backwards, which is where mistakes get made.
 *
 * NOTHING IS HIDDEN. Superseded checks, failed checks and every amendment stay
 * on the page, marked but present. A trail that showed only the current state
 * would be a summary, and a summary is exactly what is useless in the situation
 * this exists for — a dispute, months later, where the question is not "was
 * this approved" but "on what basis".
 *
 * Detail is collapsed by default and opens per entry. Twelve entries each with
 * eight lines of detail is a wall; twelve one-line entries with the detail a
 * click away is a history.
 */

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  MailCheck,
  PencilLine,
  Send,
  Stamp,
  UserCheck,
} from 'lucide-react';
import type { AuditEntry, AuditKind } from '@aobplatform/domain';
import { Chip, ui, type Tone } from '../ui';
import { strings } from '../strings';
import styles from './review.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

const ICONS: Record<AuditKind, typeof History> = {
  submitted: FileText,
  email_verified: MailCheck,
  correction_requested: Send,
  amended: PencilLine,
  check: ClipboardCheck,
  evidence: FileText,
  ceremony: UserCheck,
  decision: Stamp,
};

/** The tone is about what KIND of event it is, never about whether it went well. */
const TONES: Record<AuditKind, Tone> = {
  submitted: 'neutral',
  email_verified: 'ok',
  correction_requested: 'warn',
  amended: 'warn',
  check: 'neutral',
  evidence: 'neutral',
  ceremony: 'ok',
  decision: 'ok',
};

interface Trail {
  entries: Array<AuditEntry & { detail?: Record<string, string> }>;
  summary: { checks: number; amendments: number; evidence: number; people: string[] };
}

/** "21 Aug 2026, 4:12 pm" — a date somebody can quote down a phone. */
function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AuditTrail({ practiceId, reloadKey }: { practiceId: string; reloadKey: number }) {
  const [trail, setTrail] = useState<Trail | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/organisations/audit`, { headers: { 'x-practice-id': practiceId } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Trail) => live && setTrail(data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // reloadKey re-reads after a check is recorded, so the trail is never stale
    // against the checklist immediately above it.
  }, [practiceId, reloadKey]);

  if (!trail) return <p className={ui.hint}>{strings.review.loading}</p>;

  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <>
      <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }}>
        {strings.review.auditLead}
      </p>

      <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }} data-testid="audit-summary">
        <strong>{trail.summary.checks}</strong> {strings.review.auditChecks} ·{' '}
        <strong>{trail.summary.amendments}</strong> {strings.review.auditAmendments} ·{' '}
        <strong>{trail.summary.evidence}</strong> {strings.review.auditEvidence}
        {trail.summary.people.length > 0 && (
          <>
            {' '}
            · {strings.review.auditPeople} {trail.summary.people.join(', ')}
          </>
        )}
      </p>

      <ol className={styles.trail} data-testid="audit-trail">
        {trail.entries.map((entry, i) => {
          const Icon = ICONS[entry.kind] ?? History;
          const isOpen = open.has(i);
          const details = Object.entries(entry.detail ?? {});
          return (
            <li className={styles.trailItem} key={`${entry.at}-${entry.kind}-${i}`}>
              <div className={`${styles.trailDot} ${entry.supersedes ? styles.trailDotFaded : ''}`}>
                <Icon size={14} aria-hidden="true" />
              </div>

              <div className={styles.trailBody}>
                <button
                  type="button"
                  className={styles.trailHead}
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  disabled={details.length === 0}
                  data-testid={`audit-entry-${i}`}
                >
                  {details.length > 0 &&
                    (isOpen ? (
                      <ChevronDown size={14} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} aria-hidden="true" />
                    ))}
                  <span className={`${styles.trailSummary} ${entry.supersedes ? styles.trailFaded : ''}`}>
                    {entry.summary}
                  </span>
                  {/* Marked, never removed — a reviewer changing their mind is
                      itself part of the record. */}
                  {entry.supersedes && <Chip tone="neutral">{strings.review.auditSuperseded}</Chip>}
                  <Chip tone={TONES[entry.kind] ?? 'neutral'}>{strings.review.auditKinds[entry.kind]}</Chip>
                </button>

                <div className={styles.trailMeta}>
                  {when(entry.at)}
                  {entry.who && (
                    <>
                      {' · '}
                      {strings.review.historyBy} <strong>{entry.who}</strong>
                    </>
                  )}
                </div>

                {isOpen && details.length > 0 && (
                  <dl className={styles.trailDetail}>
                    {details.map(([term, value]) => (
                      <div key={term}>
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
