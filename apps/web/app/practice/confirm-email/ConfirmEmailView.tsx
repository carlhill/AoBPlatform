'use client';

/**
 * "Confirm your new administrator address" — the page the emailed link opens.
 *
 * REACHED WITHOUT A SESSION, deliberately. Whoever holds the new address has
 * not signed in and may never have: they are proving they can receive mail
 * there, which is the one thing that lets the change take effect. Requiring a
 * session would mean only somebody already signed in could confirm, and the
 * person confirming is precisely the one who cannot be.
 *
 * THE LINK ALONE DOES NOTHING. Opening this page confirms nothing and changes
 * nothing — it asks for the code from the same message. Mail scanners, link
 * previews and antivirus gateways all issue GETs, so a scheme where arriving
 * here were enough would have addresses confirming themselves with nobody
 * involved.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function ConfirmEmailView() {
  const token = useSearchParams().get('token') ?? '';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/pending-email-change/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be confirmed (${res.status}).`);
      setDone(body.detail ?? strings.confirmEmail.doneFallback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /*
   * A MISSING TOKEN IS ITS OWN ANSWER. Somebody who typed the address by hand,
   * or whose mail client mangled the link, needs to be told that rather than
   * shown a form that cannot work.
   */
  if (!token) {
    return (
      <Shell>
        <h1 className={ui.pageTitle}>{strings.confirmEmail.title}</h1>
        <Notice tone="stop" title={strings.confirmEmail.noTokenTitle}>
          {strings.confirmEmail.noTokenBody}
        </Notice>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 className={ui.pageTitle}>{strings.confirmEmail.title}</h1>
        <Notice tone="ok" title={strings.confirmEmail.doneTitle}>
          <CheckCircle2 size={15} aria-hidden="true" /> {done}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={ui.pageTitle}>{strings.confirmEmail.title}</h1>
      <p className={ui.lead}>{strings.confirmEmail.lead}</p>

      <Field label={strings.confirmEmail.code} hint={strings.confirmEmail.codeHint} required>
        {(props) => (
          <TextInput
            {...props}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            data-testid="confirm-code"
          />
        )}
      </Field>

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || code.trim().length !== 6}
          data-testid="confirm-submit"
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busy ? strings.confirmEmail.confirming : strings.confirmEmail.confirm}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.confirmEmail.failed}>
          {error}
        </Notice>
      )}

      <Notice title={strings.confirmEmail.whatHappensTitle}>
        {strings.confirmEmail.whatHappensBody}
      </Notice>
    </Shell>
  );
}
