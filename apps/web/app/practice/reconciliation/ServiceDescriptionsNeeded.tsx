'use client';

/**
 * D6a, ON A STAFF SURFACE — the drafts that cannot be completed until somebody
 * chooses the basic description of the service.
 *
 * WHY IT IS HERE RATHER THAN ON THE KIOSK. A pre-agreement drafted from the
 * appointment book has no Basic Service Description, because no MBS mapping
 * exists to derive one (CONSULTATION-CAPTURE-PLAN §2.4). C6 refuses the lock,
 * and the tablet hands over — correctly: "the tablet never presents a field
 * that a patient or a passer-by could fill on the practice's behalf" (Carl,
 * 3 Sep 2026). The work has to land somewhere with a named staff member behind
 * it, and this is that place.
 *
 * WHY IT IS ON THE RECONCILIATION SCREEN AND NOT `/practice/queue`. Neither
 * screen's rows are pre-agreement drafts today: `/practice/queue` is the
 * PLATFORM's outbound message queue (page-access.ts classifies it `platform`
 * despite the path), and reconciliation is the practice's post-service list.
 * Reconciliation is the one of the two that is a PRACTICE audience with a
 * view-only platform twin, which is exactly the pair this control needs — so
 * it hosts the section, as its own list above the queue rather than pretending
 * a draft is an outstanding service.
 *
 * WHY THE OPTIONS COME FROM THE SERVER. They are the exact strings the rules
 * engine matches, case-sensitively, and they are versioned content (hard rule
 * 14). A list in this file would be a second copy that goes stale the moment
 * the mapping moves — which is the failure mode versioning exists to prevent.
 * So the select renders `GET /service-descriptions`, in the order it arrives,
 * and this component knows none of the words.
 *
 * VIEW-ONLY IS HANDLED BY CONSTRUCTION. The platform twin wraps this page in a
 * disabled `fieldset`, which disables every select and button beneath it
 * including ones added later. The audience check below is the second fence,
 * for the case where somebody reaches the practice route without a practice
 * claim: the state is readable, the control is not offered.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { audiencesOf, mayReach, type Audience } from '@aobplatform/domain';
import { Button, Chip, Notice, ui } from '../../ui';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export type PendingRow = {
  agreementId: string;
  patientName: string | null;
  providerName: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  currentDescription: string | null;
  setBy: string | null;
  setAt: string | null;
  createdAt: string;
};

type Content = { version: string; descriptions: string[] };

type SetResult = {
  validation: { c6: string; otherFailures: string[] } | null;
};

/**
 * May this account actually set a description, as against read the list?
 *
 * `mayReach` answers the page — and it answers YES for the platform, because
 * the read-only twin is meant to be readable. The ACT is the practice's own
 * (the same rule `@PracticeScoped` states on the server), so it additionally
 * needs the practice audience, which an operator acting as the practice holds
 * by construction and an operator merely looking does not.
 */
export function mayActOnDescriptions(audiences: readonly Audience[]): boolean {
  return mayReach('/practice/reconciliation', audiences) && audiences.includes('practice');
}

/** "Thu 3 Sep, 09:00" — or nothing, for a walk-in with no booked time. */
export function whenLabel(row: Pick<PendingRow, 'appointmentDate' | 'appointmentTime'>): string | null {
  if (!row.appointmentDate) return row.appointmentTime;
  const date = new Date(row.appointmentDate);
  const day = Number.isNaN(date.getTime())
    ? row.appointmentDate
    : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return row.appointmentTime ? `${day}, ${row.appointmentTime}` : day;
}

/**
 * What to say after a successful set. The rules engine has the last word, so
 * the message reports what it actually said rather than assuming the row is
 * now clear.
 */
export function outcomeMessage(result: SetResult): string {
  if (!result.validation) return strings.serviceDescription.notChecked;
  if (result.validation.otherFailures.length > 0) {
    return strings.serviceDescription.stillBlocked.replace('{rules}', result.validation.otherFailures.join(', '));
  }
  return strings.serviceDescription.cleared;
}

export function ServiceDescriptionsNeeded({ practiceId }: { practiceId: string }) {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * THE SESSION'S OWN CLAIM, NEVER THE PAGE'S `practiceId` PROP.
   *
   * The prop says which practice the page is ABOUT — on the read-only twin it
   * comes from the URL. Feeding it in here as a fallback granted the
   * `practice` audience to a platform operator looking at somebody else's
   * reconciliation screen, and enabled the control. A test caught it. Which
   * practice a page is about and what the caller may DO are different
   * questions, and only the token answers the second one; the server answers
   * it the same way, and refuses either way.
   */
  const audiences: Audience[] = useMemo(() => {
    const session = currentSession();
    return audiencesOf({
      roles: session?.roles,
      practiceId: session?.practiceId ?? null,
      practitionerId: session?.practitionerId,
    });
  }, []);
  const mayAct = mayActOnDescriptions(audiences);
  const signedIn = currentSession() !== null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, c] = await Promise.all([
        fetch(`${CORE_URL}/service-descriptions/pending`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/service-descriptions`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!p.ok || !c.ok) throw new Error(String(p.ok ? c.status : p.status));
      setRows((await p.json()) as PendingRow[]);
      setContent((await c.json()) as Content);
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDescription(row: PendingRow) {
    const description = chosen[row.agreementId];
    if (!description) return;
    setBusyId(row.agreementId);
    setOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/service-descriptions/agreements/${row.agreementId}`, {
        method: 'POST',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const body = (await res.json().catch(() => ({}))) as SetResult & { message?: string };
      if (!res.ok) throw new Error(body.message ?? strings.serviceDescription.setFailed);
      setOutcome({ id: row.agreementId, text: outcomeMessage(body), ok: true });
      // The row leaves this list because the server no longer returns it — the
      // list is re-read rather than patched, so what is on screen is what the
      // server thinks rather than what this component hoped.
      await load();
    } catch (e) {
      setOutcome({
        id: row.agreementId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null && error === null) return null;

  return (
    <section data-testid="service-descriptions-needed">
      <h2 className={ui.sectionTitle}>
        <ClipboardList size={16} aria-hidden="true" /> {strings.serviceDescription.title}
      </h2>
      <p className={ui.hint}>{strings.serviceDescription.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.reconciliation.unreachableTitle}>
          {error}
        </Notice>
      )}

      {!signedIn && (
        <Notice tone="warn" title={strings.serviceDescription.noSession}>
          {strings.serviceDescription.whyNotOnTablet}
        </Notice>
      )}
      {signedIn && !mayAct && (
        <Notice tone="warn" title={strings.serviceDescription.viewOnly}>
          {strings.serviceDescription.whyNotOnTablet}
        </Notice>
      )}

      <div className={styles.queueSummary}>
        <Chip tone={rows && rows.length ? 'warn' : 'ok'}>
          {strings.serviceDescription.count.replace('{n}', String(rows?.length ?? 0))}
        </Chip>
        {content && (
          <Chip tone="neutral">
            {strings.serviceDescription.listVersion.replace('{version}', content.version)}
          </Chip>
        )}
        <Button variant="subtle" onClick={() => void load()} disabled={busyId !== null}>
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      {rows && rows.length === 0 ? (
        <p className={ui.hint}>{strings.serviceDescription.none}</p>
      ) : (
        <ul className={styles.queueList} data-testid="service-descriptions-list">
          {(rows ?? []).map((row) => {
            const said = outcome?.id === row.agreementId ? outcome : null;
            return (
              <li key={row.agreementId} className={`${styles.queueRow} ${styles.sdRow}`} data-testid={`sd-row-${row.agreementId}`}>
                <div>
                  <strong>{row.patientName ?? '—'}</strong>
                  <div className={ui.hint}>
                    {[row.providerName, whenLabel(row)].filter(Boolean).join(' · ') || null}
                  </div>
                  {row.currentDescription && (
                    <Chip tone="warn">{strings.serviceDescription.staleShort}</Chip>
                  )}
                </div>

                <label className={ui.label} htmlFor={`sd-${row.agreementId}`}>
                  {strings.serviceDescription.selectLabel}
                </label>
                <select
                  id={`sd-${row.agreementId}`}
                  className={ui.select}
                  data-testid={`sd-select-${row.agreementId}`}
                  value={chosen[row.agreementId] ?? ''}
                  disabled={!mayAct || busyId !== null || !content}
                  onChange={(e) => setChosen((c) => ({ ...c, [row.agreementId]: e.target.value }))}
                >
                  <option value="">{strings.serviceDescription.selectPlaceholder}</option>
                  {/* IN THE ORDER THE SERVER SENT. File order is screen order. */}
                  {(content?.descriptions ?? []).map((description) => (
                    <option key={description} value={description}>
                      {description}
                    </option>
                  ))}
                </select>

                <Button
                  onClick={() => void setDescription(row)}
                  disabled={!mayAct || busyId !== null || !chosen[row.agreementId]}
                  data-testid={`sd-set-${row.agreementId}`}
                >
                  {busyId === row.agreementId ? strings.serviceDescription.setting : strings.serviceDescription.set}
                </Button>

                {row.currentDescription && <p className={ui.hint}>{strings.serviceDescription.stale}</p>}
                {said && (
                  <Notice tone={said.ok ? 'ok' : 'stop'} title={said.text} data-testid={`sd-outcome-${row.agreementId}`}>
                    {said.ok ? strings.serviceDescription.setDone : strings.serviceDescription.setFailed}
                  </Notice>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
