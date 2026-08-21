'use client';

/**
 * Confirming an email address, in two phases.
 *
 * PHASE 1 is the link, and it deliberately does nothing. Opening this page
 * changes no state at all — which is the entire point. A bare confirmation link
 * is consumed by a GET, and plenty of things issue a GET that are not the
 * recipient: corporate mail scanners, link-preview bots, antivirus gateways,
 * and the "safe links" rewriting several mail providers apply to every URL
 * passing through them. Each of those would have marked an address confirmed
 * with no human involved, and the signal would have been weakest exactly where
 * it mattered most — a practice on managed corporate mail.
 *
 * PHASE 2 is the code, and it is the phase that confirms. Somebody has to read
 * the message and type six digits. A scanner may fetch this page all it likes.
 *
 * What the page may show BEFORE a code is entered is deliberately almost
 * nothing — in particular not the practice name. The URL may have been
 * forwarded, and naming the practice would confirm to whoever holds the link
 * that this entity applied to us.
 */

import { useEffect, useState } from 'react';
import { MailCheck, MailX, ShieldCheck } from 'lucide-react';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type State = 'live' | 'expired' | 'locked' | 'already_verified' | 'unknown';

export function VerifyView({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    fetch(`${CORE_URL}/applications/verify/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { state: State; attemptsLeft: number }) => {
        setState(data.state);
        setAttemptsLeft(data.attemptsLeft);
      })
      .catch(() => setState('unknown'));
  }, [token]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${CORE_URL}/applications/verify/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? strings.verify.wrongCode);
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
      // Re-read, because a wrong code has just consumed one of five attempts
      // and the remaining count is the thing the applicant needs to see.
      fetch(`${CORE_URL}/applications/verify/${token}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { state: State; attemptsLeft: number } | null) => {
          if (data) {
            setState(data.state);
            setAttemptsLeft(data.attemptsLeft);
          }
        })
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <Shell right={strings.verify.audience}>
        <h1 className={ui.pageTitle}>
          <MailCheck size={26} aria-hidden="true" /> {strings.verify.okTitle}
        </h1>
        <p className={ui.pageLead}>{strings.verify.okBody}</p>
        <p className={ui.hint}>{strings.verify.nothingElse}</p>
      </Shell>
    );
  }

  if (state === null) {
    return (
      <Shell right={strings.verify.audience}>
        <p className={ui.hint}>{strings.verify.checking}</p>
      </Shell>
    );
  }

  if (state !== 'live') {
    const title =
      state === 'already_verified'
        ? strings.verify.alreadyTitle
        : state === 'locked'
          ? strings.verify.lockedTitle
          : state === 'expired'
            ? strings.verify.expiredTitle
            : strings.verify.failTitle;
    const body =
      state === 'already_verified'
        ? strings.verify.alreadyBody
        : state === 'locked'
          ? strings.verify.lockedBody
          : state === 'expired'
            ? strings.verify.expiredBody
            : strings.verify.failBody;

    return (
      <Shell right={strings.verify.audience}>
        <h1 className={ui.pageTitle}>
          {state === 'already_verified' ? (
            <ShieldCheck size={26} aria-hidden="true" />
          ) : (
            <MailX size={26} aria-hidden="true" />
          )}{' '}
          {title}
        </h1>
        <p className={ui.pageLead}>{body}</p>
      </Shell>
    );
  }

  return (
    <Shell right={strings.verify.audience}>
      <h1 className={ui.pageTitle}>{strings.verify.enterTitle}</h1>
      <p className={ui.pageLead}>{strings.verify.enterLead}</p>

      {error && (
        <Notice tone="stop" title={strings.verify.wrongCode}>
          {error}
        </Notice>
      )}

      <div style={{ maxWidth: 260 }}>
        <Field
          label={strings.verify.codeLabel}
          hint={
            attemptsLeft !== null && attemptsLeft < 5
              ? strings.verify.attemptsLeft.replace('{n}', String(attemptsLeft))
              : strings.verify.codeHint
          }
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={code}
              // A numeric keypad on a phone, and browser autofill for the
              // one-time code some clients surface from the message itself.
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^\d{6}$/.test(code)) void submit();
              }}
              data-testid="verify-code"
            />
          )}
        </Field>
      </div>

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          disabled={!/^\d{6}$/.test(code) || busy}
          onClick={submit}
          data-testid="verify-submit"
        >
          {busy ? strings.verify.confirming : strings.verify.confirm}
        </Button>
      </div>

      <p className={ui.hint} style={{ marginTop: 'var(--s5)' }}>
        {strings.verify.whyCode}
      </p>
    </Shell>
  );
}
