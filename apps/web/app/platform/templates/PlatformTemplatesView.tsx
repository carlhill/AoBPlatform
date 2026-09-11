'use client';

/**
 * AGREEMENT WORDING REVIEW — the platform's side of `/practice/templates`
 * (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1).
 *
 * THE ONE ACT ON THIS PAGE IS ACTIVATION, and it is the reason the page
 * exists. A practice may write its own version of the words its patients sign;
 * it may not put them in front of a patient on its own say-so. Every other
 * layer is mechanical — the loader has already refused an amount, a
 * practitioner signature line, the approval words and a missing data element
 * before a row could reach this queue — and what is left is the thing only a
 * person can do: read the sentences and decide whether they are true and fair.
 *
 * SO THE PAGE SHOWS THE WORDS FIRST AND THE BUTTONS LAST, and says out loud
 * what the mechanical checks already covered. A reviewer who does not know
 * what is already checked will either re-check it or check nothing.
 *
 * SENDING BACK REQUIRES A REASON. The server refuses an empty one; this asks
 * for it rather than letting somebody discover the refusal.
 *
 * CROSS-PRACTICE, WHICH ALMOST NOTHING ELSE HERE IS. The queue's question is
 * "what is waiting", not "what is waiting at this practice", and the read
 * behind it is a narrow SECURITY DEFINER function carrying a practice name, a
 * type, a version, a date and the words — no patient data of any kind.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button, Chip, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../../practice/manage.module.css';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { TemplatePreview } from '../../practice/templates/TemplatesView';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface WaitingRow {
  id: string;
  practiceId: string;
  practiceName: string;
  agreementType: 'episodic' | 'enduring';
  version: string;
  status: 'in_review' | 'active';
  body: {
    title: string;
    sections: { key: string; heading: string; paragraphs: string[] }[];
    statements: { key: string; text: string }[];
    footer: string[];
  };
  notes: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  activatedAt: string | null;
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

export function PlatformTemplatesView() {
  const [rows, setRows] = useState<WaitingRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${CORE_URL}/platform/agreement-templates`, { headers: apiHeaders() });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const body = (await res.json()) as { waiting: WaitingRow[] };
      setRows(body.waiting);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(row: WaitingRow, action: 'activate' | 'request-changes') {
    const s = strings.platformTemplates;
    setBusy(row.id);
    setError(null);
    setDone(null);
    try {
      const reviewNotes = notes[row.id] ?? '';
      if (action === 'request-changes' && !reviewNotes.trim()) throw new Error(s.notesRequired);
      const res = await fetch(
        `${CORE_URL}/platform/agreement-templates/${row.practiceId}/${row.id}/${action}`,
        {
          method: 'POST',
          headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewNotes: reviewNotes.trim() || undefined }),
        },
      );
      if (!res.ok) throw new Error(await refusalMessage(res));
      setDone(action === 'activate' ? s.activated : s.sentBack);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const s = strings.platformTemplates;
  const waiting = (rows ?? []).filter((row) => row.status === 'in_review');
  const active = (rows ?? []).filter((row) => row.status === 'active');

  return (
    <Shell title={s.title} lead={s.lead} right={<SessionControl audience={s.audience} />}>
      {loadError && <Notice tone="warn">{`${s.notLoaded}: ${loadError}`}</Notice>}
      {rows === null && !loadError && <p className={ui.hint}>{s.loading}</p>}
      {rows !== null && waiting.length === 0 && <Notice tone="ok">{s.empty}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}

      {waiting.length > 0 && (
        <p className={ui.hint} data-testid="waiting-count">
          {s.waitingCount(waiting.length)}
        </p>
      )}

      {waiting.map((row) => (
        <div key={row.id} className={styles.card} style={{ marginTop: 'var(--s3)' }} data-testid={`review-${row.id}`}>
          <div className={styles.cardHead}>
            <ScrollText size={18} aria-hidden="true" className={styles.cardIcon} />
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{row.practiceName}</p>
              <p className={styles.cardNote}>
                {strings.templates.typeName[row.agreementType]} · {row.version}
              </p>
              {row.submittedByName && row.submittedAt && (
                <p className={styles.cardNote}>
                  {s.submittedBy(row.submittedByName, new Date(row.submittedAt).toLocaleString('en-AU'))}
                </p>
              )}
              {row.notes && <p className={styles.cardNote}>{row.notes}</p>}
            </div>
            <div className={styles.cardAside}>
              <Chip tone="warn">{strings.templates.statusName[row.status]}</Chip>
            </div>
          </div>
          <div className={styles.cardBody}>
            {/* THE WORDS FIRST. The buttons are below them, deliberately. */}
            <TemplatePreview body={row.body} />
            <p className={styles.cardNote}>{s.alreadyChecked}</p>

            <label className={ui.hint} htmlFor={`notes-${row.id}`}>
              {s.notesLabel}
            </label>
            <textarea
              id={`notes-${row.id}`}
              className={ui.input}
              rows={3}
              value={notes[row.id] ?? ''}
              onChange={(e) => setNotes((current) => ({ ...current, [row.id]: e.target.value }))}
              data-testid={`notes-${row.id}`}
            />
            <div className={styles.formActions}>
              <Button
                variant="primary"
                disabled={busy === row.id}
                onClick={() => void act(row, 'activate')}
                data-testid={`activate-${row.id}`}
              >
                {s.activate}
              </Button>
              <Button
                disabled={busy === row.id}
                onClick={() => void act(row, 'request-changes')}
                data-testid={`send-back-${row.id}`}
              >
                {s.requestChanges}
              </Button>
            </div>
          </div>
        </div>
      ))}

      {active.length > 0 && (
        <div className={styles.card} style={{ marginTop: 'var(--s4)' }}>
          <div className={styles.cardHead}>
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{s.inUse(String(active.length))}</p>
            </div>
          </div>
          <div className={styles.cardBody}>
            {active.map((row) => (
              <div key={row.id} className={styles.subItem} data-testid={`active-${row.id}`}>
                <p className={styles.cardNote}>
                  {row.practiceName} · {strings.templates.typeName[row.agreementType]} · {row.version}
                  {row.reviewedByName ? ` · ${row.reviewedByName}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
