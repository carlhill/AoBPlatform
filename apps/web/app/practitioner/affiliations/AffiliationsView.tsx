'use client';

/**
 * A practitioner's affiliations, and leaving one.
 *
 * ITS OWN PAGE, not a button on the hub. A departure has a date that decides
 * which agreements are valid, and two of its reasons say the listing was wrong
 * rather than that it is ending — which puts the practice in front of a
 * reviewer. That is not a control that belongs beside a summary card.
 *
 * LEAVING IS UNILATERAL. Nobody has to agree. If the practice had to, a
 * practice could keep somebody listed after they had gone, and consent captured
 * under that name would keep looking valid. The practice is told, not asked.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, LogOut } from 'lucide-react';
import { Button, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import styles from '../../practice/manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Affiliation = {
  id: string;
  practiceName?: string | null;
  locationCode?: string | null;
  status: string;
  startedAt?: string | null;
  endsAt?: string | null;
  endedAt?: string | null;
};

type Reason = { key: string; label: string; detail: string; suspicious: boolean };

export function AffiliationsView() {
  const [rows, setRows] = useState<Affiliation[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as { affiliations?: Affiliation[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setRows(body.affiliations ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch(`${CORE_URL}/practitioner/departure-reasons`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { reasons?: Reason[] }) => setReasons(b.reasons ?? []))
      .catch(() => setReasons([]));
  }, [load]);

  if (!currentSession()) {
    return (
      <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
        <h1 className={ui.pageTitle}>{strings.myAffiliations.title}</h1>
        <Notice tone="warn" title={strings.practitioner.signedOutTitle}>
          {strings.practitioner.signedOutBody}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
      <h1 className={ui.pageTitle}>{strings.myAffiliations.title}</h1>
      <p className={ui.pageLead}>{strings.myAffiliations.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.myAffiliations.failed}>
          {error}
        </Notice>
      )}
      {done && (
        <Notice tone="ok" title={strings.myAffiliations.doneTitle}>
          {done}
        </Notice>
      )}

      {rows.length === 0 && !error && (
        <Notice title={strings.myAffiliations.emptyTitle}>{strings.myAffiliations.emptyBody}</Notice>
      )}

      <ul className={ui.list}>
        {rows.map((a) => (
          <AffiliationRow
            key={a.id}
            affiliation={a}
            reasons={reasons}
            onDone={async (message) => {
              setDone(message);
              await load();
            }}
          />
        ))}
      </ul>
    </Shell>
  );
}

function AffiliationRow({
  affiliation,
  reasons,
  onDone,
}: {
  affiliation: Affiliation;
  reasons: Reason[];
  onDone: (message: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = reasons.find((r) => r.key === reason);
  // The two that say the listing was wrong take effect at once, so offering a
  // date beside them would suggest a choice that is not being honoured.
  const immediate = chosen?.suspicious === true;
  const needsWords = immediate || reason === 'other';

  async function depart() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me/affiliations/${affiliation.id}/depart`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          reason,
          note: note.trim() || undefined,
          endsAt: !immediate && endsAt ? new Date(endsAt).toISOString() : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be recorded (${res.status}).`);
      setOpen(false);
      await onDone(body.detail ?? strings.myAffiliations.recorded);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const live = affiliation.status === 'active';

  return (
    <li className={styles.reviewCard}>
      <div className={styles.reviewHead}>
        <span className={styles.reviewKind}>{affiliation.practiceName ?? strings.practitioner.unnamedPractice}</span>
        <span className={styles.queueWhen}>{affiliation.status}</span>
        {affiliation.locationCode && <span className={styles.queueWhen}>{affiliation.locationCode}</span>}
      </div>

      {affiliation.endsAt && !affiliation.endedAt && (
        <p className={styles.cardNote}>
          <CalendarClock size={13} aria-hidden="true" /> {strings.myAffiliations.endsOn}{' '}
          {affiliation.endsAt.slice(0, 10)}
        </p>
      )}
      {affiliation.endedAt && (
        <p className={styles.cardNote}>
          {strings.myAffiliations.endedOn} {affiliation.endedAt.slice(0, 10)}
        </p>
      )}

      {/* Only a live affiliation can be left. An ended one is history. */}
      {live && !open && (
        <Button onClick={() => setOpen(true)} data-testid={`leave-${affiliation.id}`}>
          <LogOut size={14} aria-hidden="true" />
          {strings.myAffiliations.leave}
        </Button>
      )}

      {live && open && (
        <>
          <div className={styles.applicationFields}>
            <Field label={strings.myAffiliations.reason} hint={chosen?.detail ?? strings.myAffiliations.reasonHint} required>
              {(props) => (
                <SelectInput
                  {...props}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid={`reason-${affiliation.id}`}
                >
                  <option value="">{strings.myAffiliations.chooseReason}</option>
                  {reasons.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>

            {/*
              The date is hidden for the immediate reasons rather than disabled.
              "I never worked here" and "…from next month" cannot both be true,
              and showing a field the server will ignore is a promise not kept.
            */}
            {reason && !immediate && (
              <Field label={strings.myAffiliations.lastDay} hint={strings.myAffiliations.lastDayHint}>
                {(props) => (
                  <TextInput
                    {...props}
                    type="date"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    data-testid={`ends-${affiliation.id}`}
                  />
                )}
              </Field>
            )}

            {needsWords && (
              <Field label={strings.myAffiliations.note} hint={strings.myAffiliations.noteHint} required>
                {(props) => (
                  <TextInput
                    {...props}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    data-testid={`note-${affiliation.id}`}
                  />
                )}
              </Field>
            )}
          </div>

          {immediate && (
            <Notice tone="warn" title={strings.myAffiliations.immediateTitle}>
              {strings.myAffiliations.immediateBody}
            </Notice>
          )}

          <div className={ui.rowActions}>
            <Button
              variant="primary"
              onClick={() => void depart()}
              disabled={busy || !reason || (needsWords && !note.trim())}
              data-testid={`confirm-leave-${affiliation.id}`}
            >
              {busy ? strings.myAffiliations.recording : strings.myAffiliations.confirmLeave}
            </Button>
            <Button variant="subtle" onClick={() => setOpen(false)}>
              {strings.locations.confirmCancel}
            </Button>
          </div>

          {error && (
            <Notice tone="stop" title={strings.myAffiliations.failed}>
              {error}
            </Notice>
          )}
        </>
      )}
    </li>
  );
}
