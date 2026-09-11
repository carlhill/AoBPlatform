'use client';

/**
 * "Show me the history of THIS row" — the pattern, once.
 *
 * WHY A COMPONENT AND NOT A PAGE. The question is always asked in front of a
 * fact somebody is already looking at: this practitioner's register check, this
 * practice's address changes, this affiliation's status. Sending them to a
 * separate screen loses which row they meant, and they arrive at a list they
 * then have to search for the thing that was under their cursor a second ago.
 *
 * WHY IT FETCHES ON OPEN, NOT ON RENDER. A roster of forty practitioners would
 * otherwise make forty requests to populate forty panels nobody opened. Asked
 * for is asked for; rendered is not.
 *
 * WHY IT IS DELIBERATELY GENERIC. Carl's words: "we will need this pattern
 * across our solution." The alternative is the shape this codebase has already
 * been bitten by — the same idea written slightly differently in five places,
 * four of which then miss a fix. This one takes a URL, a row renderer and an
 * empty message, and knows nothing about what it is showing.
 *
 * WHAT IT REFUSES TO GUESS. If the history cannot be read it says so and shows
 * nothing. An empty panel where an error belongs reads as "there is no history",
 * which is a different and much more comforting statement than "we could not
 * find out" — and the comforting one is the wrong default for a record of who
 * attested what.
 */

import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { Button, Notice, ui } from './ui';
import { apiHeaders } from './auth';
import { strings } from './strings';

export function HistoryDisclosure<T>({
  url,
  practiceId,
  extract,
  renderRow,
  emptyMessage,
  label,
  testId,
}: {
  /** Absolute URL of the history endpoint. */
  url: string;
  /** Passed to apiHeaders when the read is practice-scoped. */
  practiceId?: string;
  /** Pull the rows out of whatever shape the endpoint returns. */
  extract: (body: unknown) => T[];
  renderRow: (row: T, index: number) => React.ReactNode;
  /** Said when there is genuinely no history — never when a read failed. */
  emptyMessage: string;
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: apiHeaders(practiceId) });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setRows(extract(body));
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
      // NOT left as a stale list. Showing the previous answer beside an error
      // invites somebody to read it as the current one.
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, [url, practiceId, extract]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Re-read on each open rather than caching: a history panel is opened
    // BECAUSE somebody suspects it changed.
    if (next) void load();
  }

  return (
    <div className={ui.historyBlock}>
      <Button variant="subtle" onClick={toggle} data-testid={testId ?? 'history-toggle'}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <History size={14} aria-hidden="true" />
        {label ?? strings.history.show}
      </Button>

      {open && (
        <div className={ui.historyPanel}>
          {busy && <p className={ui.hint}>{strings.history.loading}</p>}

          {error && (
            <Notice tone="stop" title={strings.history.notLoaded}>
              {error}
            </Notice>
          )}

          {!busy && !error && rows !== null && rows.length === 0 && <p className={ui.hint}>{emptyMessage}</p>}

          {!busy && !error && rows !== null && rows.length > 0 && (
            <ol className={ui.historyList}>
              {rows.map((row, i) => (
                <li key={i}>{renderRow(row, i)}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
