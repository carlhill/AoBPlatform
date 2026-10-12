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
 *
 * DRESSED LIKE /verify AND /practice/confirm-backup, on purpose. All three ask
 * a stranger to type a code from an email, which is precisely the interaction
 * a phishing site asks for — Carl's words on the first cut of this shape:
 * "this looks cheap." One stylesheet rather than three near-copies, so they
 * cannot drift apart from each other.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button, Notice, Shell } from '../../ui';
import { strings } from '../../strings';
import styles from '../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function ConfirmEmailView() {
  const token = useSearchParams().get('token') ?? '';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const Wordmark = (
    <div className={styles.mark}>
      <ShieldCheck size={20} aria-hidden="true" />
      <span className={styles.markText}>{strings.appName}</span>
    </div>
  );

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

  // A missing token is its own answer: a form that cannot work must not be
  // shown as though it could.
  if (!token) {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <h1 className={styles.title}>{strings.confirmEmail.title}</h1>
          <Notice tone="stop" title={strings.confirmEmail.noTokenTitle}>
            {strings.confirmEmail.noTokenBody}
          </Notice>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcomeIcon}>
            <CheckCircle2 size={40} aria-hidden="true" />
          </div>
          <h1 className={styles.title}>{strings.confirmEmail.doneTitle}</h1>
          <p className={styles.lead}>{done}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.confirmEmail.title}</h1>
        <p className={styles.lead}>{strings.confirmEmail.lead}</p>

        {error && (
          <Notice tone="stop" title={strings.confirmEmail.failed}>
            {error}
          </Notice>
        )}

        <div className={styles.codeWrap}>
          <label className={styles.codeLabel} htmlFor="confirm-code">
            {strings.confirmEmail.code}
          </label>
          <input
            id="confirm-code"
            className={`${styles.code} ${error ? styles.codeInvalid : ''}`}
            value={code}
            placeholder="––––––"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            aria-describedby="confirm-code-hint"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^\d{6}$/.test(code)) void submit();
            }}
            data-testid="confirm-code"
          />
          <p id="confirm-code-hint" className={styles.codeHint}>
            {strings.confirmEmail.codeHint}
          </p>
        </div>

        <Button
          variant="primary"
          className={styles.submit}
          disabled={busy || !/^\d{6}$/.test(code)}
          onClick={() => void submit()}
          data-testid="confirm-submit"
        >
          {busy ? strings.confirmEmail.confirming : strings.confirmEmail.confirm}
        </Button>

        {/* What confirming actually does, before they do it. */}
        <div className={styles.why}>
          <div className={styles.whyHead}>
            <ShieldCheck size={16} aria-hidden="true" />
            {strings.confirmEmail.whatHappensTitle}
          </div>
          {strings.confirmEmail.whatHappensBody}
        </div>
      </div>
    </Shell>
  );
}
