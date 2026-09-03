'use client';

/**
 * One log, two audiences — the design handoff's M-1 and the Messages tab of P-1.
 *
 * "M-1 and the Messages tab of P-1 are the same dispatch records rendered for
 * different readers. Build them off one query and one string table, not two
 * features." So this renders the log once and takes an AUDIENCE, and three
 * screens use it: the practice's correspondence page, its view-only platform
 * twin, and the patient's own half. The practitioner's own list uses it too —
 * it was the first of the four and the reason there was a component to extract.
 *
 * WHAT THE AUDIENCE DECIDES, and it is the only thing it decides:
 *
 *   - BODIES. The practice that sent and the person who received may read what
 *     was said. The platform twin sees states, never bodies.
 *   - COST. The practice's own figure, never the patient's. (No source records
 *     it yet, so no column is drawn — see TODO.md rather than a made-up number.)
 *
 * WHAT IT NEVER DECIDES: whether an 89AA notice may be chased. That is
 * `mayChase` in the domain, answered per row, and it is false on every surface
 * for every reader (CLAUDE.md rule 7).
 */

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { type LogAudience, type LogEntry, showsBodies } from '@aobplatform/domain';
import { Button, Chip, Notice, type Tone, ui } from '../ui';
import { strings } from '../strings';
import styles from './messageLog.module.css';

/** What a row said, fetched or held by whoever owns the query. */
export interface MessageBody {
  subject: string | null;
  body: string | null;
  /**
   * Why there is no text, when the caller knows. A sign-in link is composed by
   * Keycloak, so we hold the subject and never the words — saying so is a
   * different and truer thing than "nothing was kept".
   */
  missingTitle?: string;
  missingBody?: string;
}

const STATE_TONE: Record<string, Tone> = {
  queued: 'neutral',
  sent: 'ok',
  delivered: 'ok',
  failed: 'stop',
  dead: 'stop',
  suppressed: 'warn',
};

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "Capture link", "Reminder 2", "89AA notice · one-way" — the word, always. */
export function purposeLabel(entry: LogEntry): string {
  if (entry.purpose === 'reminder' && entry.attempt) {
    return strings.correspondence.reminderNumbered.replace('{n}', String(entry.attempt));
  }
  return strings.correspondence.purposes[entry.purpose] ?? entry.purpose;
}

export function MessageLog({
  audience,
  entries,
  bodyOf,
  showWho = true,
  whoLabel = strings.correspondence.colWho,
  emptyText,
}: {
  audience: LogAudience;
  entries: LogEntry[];
  /** What the row said. Ignored entirely when the audience may not read bodies. */
  bodyOf?: (entry: LogEntry) => MessageBody | null;
  /** The patient's own list names nobody — it is all theirs. */
  showWho?: boolean;
  /** Who the first column names: the patient here, the sending practice on a practitioner's own list. */
  whoLabel?: string;
  emptyText: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const mayReadBodies = showsBodies(audience);

  if (entries.length === 0) return <p className={ui.hint}>{emptyText}</p>;

  return (
    <>
      <div className={`${styles.head} ${showWho ? '' : styles.headAnonymous}`} aria-hidden="true">
        {showWho && <span>{whoLabel}</span>}
        <span>{strings.correspondence.colPurpose}</span>
        <span>{strings.correspondence.colChannel}</span>
        <span>{strings.correspondence.colSent}</span>
        <span>{strings.correspondence.colState}</span>
        <span />
      </div>

      <ul className={styles.list} data-testid="message-log">
        {entries.map((entry) => {
          const open = openId === entry.id;
          const body = mayReadBodies && bodyOf ? bodyOf(entry) : null;
          /*
           * NO ACTION ON AN 89AA NOTICE beyond reading it. `chaseable` is false
           * on those rows and this component draws no resend control at all —
           * there is none anywhere on this screen for any row, so a notice
           * cannot acquire one by accident later.
           */
          const canOpen = entry.kind === 'suppressed' || mayReadBodies;
          return (
            <li key={entry.id} className={styles.row}>
              <div className={`${styles.rowMain} ${showWho ? '' : styles.rowAnonymous}`} data-testid={`message-row-${entry.id}`}>
                {showWho && <span className={styles.who}>{entry.who ?? '—'}</span>}
                <span className={styles.purpose}>
                  <span>{purposeLabel(entry)}</span>
                  {entry.subject && <span className={styles.subject}>{entry.subject}</span>}
                </span>
                <span className={styles.channel}>{entry.channel ?? '—'}</span>
                <span className={styles.when}>{when(entry.at)}</span>
                {/* The state is a WORD. Colour is secondary, never the carrier. */}
                <span className={styles.delivery}>
                  <Chip tone={STATE_TONE[entry.state] ?? 'neutral'}>
                    {strings.correspondence.states[entry.state] ?? entry.state}
                    {entry.failureReason ? ` · ${entry.failureReason}` : ''}
                  </Chip>
                </span>
                <span className={styles.action}>
                  {canOpen && (
                    <Button
                      variant="subtle"
                      onClick={() => setOpenId(open ? null : entry.id)}
                      data-testid={`message-open-${entry.id}`}
                    >
                      {entry.kind === 'suppressed' ? (
                        <HelpCircle size={14} aria-hidden="true" />
                      ) : open ? (
                        <ChevronDown size={14} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} aria-hidden="true" />
                      )}
                      {entry.kind === 'suppressed'
                        ? strings.correspondence.why
                        : open
                          ? strings.correspondence.hide
                          : audience === 'patient'
                            ? strings.patientMessages.view
                            : strings.correspondence.view}
                    </Button>
                  )}
                  {entry.purpose === 'notice' && (
                    <span className={ui.hint}>{strings.correspondence.noticeNoAction}</span>
                  )}
                </span>
              </div>

              {open && (
                <div className={styles.detail} data-testid={`message-detail-${entry.id}`}>
                  {entry.kind === 'suppressed' ? (
                    <Notice tone="warn" title={strings.correspondence.states.suppressed}>
                      {strings.correspondence.suppressedWhy}
                    </Notice>
                  ) : entry.contentRemoved ? (
                    // NOT A BLANK. The retention sweep took the words; the row says so.
                    <Notice title={strings.correspondence.removedTitle}>{strings.correspondence.removedBody}</Notice>
                  ) : body?.body ? (
                    <Fragment>
                      <p className={styles.detailHead}>{strings.correspondence.view}</p>
                      <pre className={styles.body}>{body.body}</pre>
                      <p className={styles.meta}>
                        {[body.subject, entry.to, entry.channel].filter(Boolean).join(' · ')}
                      </p>
                    </Fragment>
                  ) : body?.missingTitle ? (
                    <Notice title={body.missingTitle}>{body.missingBody}</Notice>
                  ) : (
                    <p className={ui.hint}>{strings.correspondence.noBody}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!mayReadBodies && (
        <Notice title={strings.correspondence.bodiesWithheldTitle}>{strings.correspondence.bodiesWithheldBody}</Notice>
      )}
    </>
  );
}
