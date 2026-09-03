'use client';

/**
 * M-1 — every message sent in this practice's name (design handoff).
 *
 * "Every message sent in this practice's name, what it said, and whether it
 * arrived. The patient sees their own half of this same list."
 *
 * THE SAME COMPONENT AS THE PATIENT'S. `MessageLog` renders the rows for all
 * four readers; this page's job is the practice's half of the question — which
 * rows, which filter, and the sends that never happened.
 *
 * A SUPPRESSED VISIT IS A ROW HERE, not a row missing. "A confidential visit
 * is suppressed before a message exists, not filtered afterwards", so it is
 * merged in from the reconciliation queue, which is where that flag lives, and
 * shown with its Why. A list that silently omits them would read as a complete
 * record and would not be one.
 *
 * RULES THIS SCREEN RESPECTS. There is no resend control on this page at all —
 * chasing is the reconciliation queue's job, and an 89AA notice is never chased
 * anywhere (rule 7). No dollar figure appears: nothing records what a send
 * cost, and a made-up one is worse than a missing column.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  type DispatchRow,
  type LogAudience,
  type LogSegment,
  LOG_SEGMENTS,
  type SuppressedSend,
  buildMessageLog,
  matchesSegment,
} from '@aobplatform/domain';
import { Button, Chip, Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { MessageLog } from '../../correspondence/MessageLog';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Row = DispatchRow & { bodyText: string | null; recipientId: string | null };

type OutstandingItem = {
  serviceRecordId: string;
  serviceDate: string;
  patientName: string | null;
  captureSuppressedReason: string | null;
  captureSuppressedAt: string | null;
};

export function CorrespondenceView({ audience = 'practice' }: { audience?: LogAudience }) {
  const { practiceId, checked } = usePractice();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [suppressed, setSuppressed] = useState<SuppressedSend[]>([]);
  const [segment, setSegment] = useState<LogSegment>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/correspondence?limit=300`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw new Error(String(res.status));
      setRows((await res.json()) as Row[]);

      /*
       * The sends that never happened. A separate call because the flag lives
       * on the service record, which the reconciliation module owns — this
       * page reads its existing endpoint rather than reaching across into its
       * table.
       */
      const queue = await fetch(`${CORE_URL}/reconciliation/outstanding`, { headers: apiHeaders(practiceId) }).catch(
        () => null,
      );
      if (queue?.ok) {
        const items = (await queue.json()) as OutstandingItem[];
        setSuppressed(
          items
            .filter((i) => i.captureSuppressedReason)
            .map((i) => ({
              serviceRecordId: i.serviceRecordId,
              patientName: i.patientName,
              reason: i.captureSuppressedReason as string,
              suppressedAt: i.captureSuppressedAt ?? i.serviceDate,
            })),
        );
      }
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefreshable(load);

  const entries = useMemo(() => buildMessageLog({ dispatches: rows ?? [], suppressed }), [rows, suppressed]);
  const shown = useMemo(() => entries.filter((e) => matchesSegment(e, segment)), [entries, segment]);
  const failures = useMemo(() => entries.filter((e) => e.state === 'failed' || e.state === 'dead').length, [entries]);

  const bodies = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);

  const right = <SessionControl audience={strings.correspondence.audience} />;

  if (!checked) return null;

  // No practice to ask about — say so rather than loading for ever.
  if (!practiceId) {
    return (
      <Shell right={right} title={strings.correspondence.title} lead={strings.correspondence.lead}>
        <Notice tone="warn" title={strings.queue.chooseTitle}>
          {strings.queue.chooseBodyPractice}
        </Notice>
      </Shell>
    );
  }

  if (rows === null) {
    return (
      <Shell right={right} title={strings.correspondence.title} lead={strings.correspondence.lead}>
        {error ? (
          <Notice tone="stop" title={strings.correspondence.unreachableTitle}>
            {error}
          </Notice>
        ) : (
          <p className={ui.hint}>{strings.correspondence.loading}</p>
        )}
      </Shell>
    );
  }

  return (
    <Shell right={right} title={strings.correspondence.title} lead={strings.correspondence.lead}>
      {error && (
        <Notice tone="stop" title={strings.correspondence.unreachableTitle}>
          {error}
        </Notice>
      )}

      <div className={styles.queueSummary} data-testid="correspondence-summary">
        <Chip tone="neutral">
          {strings.correspondence.summary
            .replace('{n}', String(entries.length))
            .replace('{failures}', String(failures))}
        </Chip>
      </div>

      <div className={styles.queueFilters}>
        <label className={ui.label} htmlFor="corr-segment">
          {strings.correspondence.segment}
        </label>
        <select
          id="corr-segment"
          className={ui.select}
          value={segment}
          onChange={(e) => setSegment(e.target.value as LogSegment)}
          data-testid="correspondence-segment"
        >
          {LOG_SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {strings.correspondence.segments[s]}
            </option>
          ))}
        </select>
        <Button variant="subtle" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      <MessageLog
        audience={audience}
        entries={shown}
        emptyText={strings.correspondence.none}
        bodyOf={(entry) => {
          const row = bodies.get(entry.id);
          return row ? { subject: row.subject ?? null, body: row.bodyText } : null;
        }}
      />

      <p className={ui.hint}>{strings.correspondence.footer}</p>
      <p className={ui.hint}>{strings.correspondence.costNote}</p>
    </Shell>
  );
}
