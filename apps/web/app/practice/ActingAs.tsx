'use client';

/**
 * Acting as somebody at a practice — starting it, and the banner while it runs.
 *
 * WHY A BANNER AND NOT JUST A BUTTON. The danger of impersonation is not that
 * it happens, it is that somebody forgets it is happening. Every screen an
 * operator opens while acting as a practice shows that practice's data and
 * looks exactly like the practice's own console; without a standing reminder,
 * the natural mistake is to believe you are looking at your own view and act
 * accordingly. So the banner is loud, permanent while the session is open, and
 * carries the way out.
 *
 * IT IS THE SUPPORTED ROUTE, NOT A BACK DOOR. Several things a practice does
 * are refused to a platform operator outright — inviting somebody, recording a
 * departure, sending an enrolment link — because they are the practice saying
 * something about itself. Acting as the practice is how support performs them,
 * and the reason that is acceptable is precisely that it is recorded: who
 * acted, for which practice, why, and the practice is told.
 *
 * The destructive verbs stay refused even here. Nothing about support needs
 * the ability to delete somebody else's records.
 */

import { useCallback, useEffect, useState } from 'react';
import { UserCheck, UserX } from 'lucide-react';
import { Button, Field, Notice, SelectInput, TextInput, ui } from '../ui';
import { apiHeaders } from '../auth';
import { strings } from '../strings';
import styles from './manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Session = {
  id: string;
  practiceId: string;
  practiceName?: string | null;
  reason: string;
  /** The reason in words, because a key is not a sentence anybody reads. */
  reasonLabel?: string | null;
  note: string | null;
  startedAt: string;
  expiresAt: string;
};

/**
 * The banner. Rendered on every practice screen, so it has to be cheap and it
 * has to fail quiet: an operator who is NOT acting as anybody should never see
 * anything, including an error about not being able to tell.
 */
export function ActingAsBanner({ onChange }: { onChange?: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/acting-as/current`, { headers: apiHeaders() });
      if (!res.ok) return;
      const body = (await res.json()) as { acting: boolean; session?: Session };
      setSession(body.acting ? (body.session ?? null) : null);
    } catch {
      // Silent. Not being able to tell is not something to shout at somebody
      // who is probably not acting as anybody at all.
    }
  }, []);

  useEffect(() => {
    void load();
    // The session expires on its own, so the banner has to notice without a
    // page change. Thirty seconds is far finer than the thirty-minute cap.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function end() {
    setBusy(true);
    try {
      await fetch(`${CORE_URL}/acting-as/end`, { method: 'POST', headers: apiHeaders() });
      setSession(null);
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className={styles.actingAsBanner} role="status" data-testid="acting-as-banner">
      <span className={styles.actingAsText}>
        <UserCheck size={15} aria-hidden="true" />{' '}
        {strings.actingAs.bannerText.replace('{practice}', session.practiceName ?? session.practiceId)}{' '}
        {session.reasonLabel && strings.actingAs.bannerReason.replace('{reason}', session.reasonLabel)}{' '}
        {session.expiresAt &&
          strings.actingAs.bannerExpires.replace(
            '{time}',
            new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          )}
      </span>
      <Button variant="subtle" onClick={() => void end()} disabled={busy} data-testid="acting-as-end">
        <UserX size={14} aria-hidden="true" />
        {busy ? strings.actingAs.ending : strings.actingAs.end}
      </Button>
    </div>
  );
}

/** Starting one. Shown to platform operators, on a practice they have chosen. */
export function ActingAsStart({
  practiceId,
  practiceName,
  onStarted,
  open: openProp,
  onOpenChange,
}: {
  practiceId: string;
  practiceName?: string | null;
  onStarted?: () => void;
  /**
   * OPTIONALLY CONTROLLED, so something else on the page can open the form.
   *
   * The practices list needs this: clicking a practice row is what an operator
   * expects to do, and that click has to land on the reason form rather than on
   * a page they will be turned away from. Left uncontrolled it keeps its own
   * state, which is what every other caller wants.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [reasons, setReasons] = useState<{ key: string; label: string; detail: string }[]>([]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    fetch(`${CORE_URL}/acting-as/catalogue`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setReasons(b.reasons ?? []))
      .catch(() => setReasons([]));
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/acting-as/start`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ practiceId, reason, note: note.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be started (${res.status}).`);
      setOpen(false);
      setNote('');
      setReason('');
      onStarted?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="acting-as-open">
        <UserCheck size={14} aria-hidden="true" />
        {strings.actingAs.start.replace('{practice}', practiceName ?? strings.actingAs.thisPractice)}
      </Button>
    );
  }

  return (
    <section className={styles.applicationSection}>
      <h2 className={styles.applicationHeading}>{strings.actingAs.startTitle}</h2>
      <p className={ui.hint}>{strings.actingAs.startBody}</p>

      <div className={styles.applicationFields}>
        <Field label={strings.actingAs.reason} hint={strings.actingAs.reasonHint} required>
          {(props) => (
            <SelectInput
              {...props}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="acting-as-reason"
            >
              <option value="">{strings.actingAs.chooseReason}</option>
              {reasons.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.actingAs.note} hint={strings.actingAs.noteHint} required>
          {(props) => (
            <TextInput {...props} value={note} onChange={(e) => setNote(e.target.value)} data-testid="acting-as-note" />
          )}
        </Field>
      </div>

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void start()}
          disabled={busy || !reason || note.trim().length < 3}
          data-testid="acting-as-start"
        >
          {busy ? strings.actingAs.starting : strings.actingAs.confirmStart}
        </Button>
        <Button variant="subtle" onClick={() => setOpen(false)}>
          {strings.locations.confirmCancel}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.actingAs.failed}>
          {error}
        </Notice>
      )}

      <Notice tone="warn" title={strings.actingAs.warnTitle}>
        {strings.actingAs.warnBody}
      </Notice>
    </section>
  );
}
