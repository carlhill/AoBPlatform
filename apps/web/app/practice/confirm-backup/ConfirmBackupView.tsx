'use client';

/**
 * "Confirm this backup address" — the page the emailed link opens.
 *
 * REACHED WITHOUT A SESSION, and by somebody who may have no account at all.
 * A backup address belongs to a spouse, a colleague, a practice manager —
 * their entire role is being reachable, and this page is how they prove it.
 * Requiring a session would mean only the practitioner could confirm their
 * own backup, which proves nothing about whether the OTHER inbox works.
 *
 * THE LINK ALONE DOES NOTHING. Opening this page confirms nothing — it asks
 * for the code from the same message, because mail scanners, link previews
 * and antivirus gateways all issue GETs, and a backup that can confirm
 * itself with nobody involved is not a proof of anything.
 *
 * DRESSED LIKE /verify, ON PURPOSE. Both pages ask a stranger to type a code
 * from an email, which is precisely the interaction a phishing site asks for
 * — so both have to look like they were built by an organisation. Carl's
 * words on the first draft: "this looks cheap". A page that looks improvised
 * teaches people that improvised-looking pages are normal, which is the
 * exact habit that makes phishing work. Same stylesheet, not a copy, so the
 * two cannot drift apart.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button, Notice, Shell } from '../../ui';
import { strings } from '../../strings';
import styles from '../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function ConfirmBackupView() {
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
      const res = await fetch(`${CORE_URL}/pending-email-change/confirm-backup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be confirmed (${res.status}).`);
      setDone(body.detail ?? strings.confirmBackup.doneFallback);
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
          <h1 className={styles.title}>{strings.confirmBackup.title}</h1>
          <Notice tone="stop" title={strings.confirmBackup.noTokenTitle}>
            {strings.confirmBackup.noTokenBody}
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
          <h1 className={styles.title}>{strings.confirmBackup.doneTitle}</h1>
          <p className={styles.lead}>{done}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.confirmBackup.title}</h1>
        <p className={styles.lead}>{strings.confirmBackup.lead}</p>

        {error && (
          <Notice tone="stop" title={strings.confirmBackup.failed}>
            {error}
          </Notice>
        )}

        <div className={styles.codeWrap}>
          <label className={styles.codeLabel} htmlFor="confirm-backup-code">
            {strings.confirmBackup.code}
          </label>
          <input
            id="confirm-backup-code"
            className={`${styles.code} ${error ? styles.codeInvalid : ''}`}
            value={code}
            placeholder="––––––"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            aria-describedby="confirm-backup-hint"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^\d{6}$/.test(code)) void submit();
            }}
            data-testid="confirm-backup-code"
          />
          <p id="confirm-backup-hint" className={styles.codeHint}>
            {strings.confirmBackup.codeHint}
          </p>
        </div>

        <Button
          variant="primary"
          className={styles.submit}
          disabled={busy || !/^\d{6}$/.test(code)}
          onClick={() => void submit()}
          data-testid="confirm-backup-submit"
        >
          {busy ? strings.confirmBackup.confirming : strings.confirmBackup.confirm}
        </Button>

        {/* What they are agreeing to, before they agree to it. */}
        <div className={styles.why}>
          <div className={styles.whyHead}>
            <ShieldCheck size={16} aria-hidden="true" />
            {strings.confirmBackup.whatTitle}
          </div>
          {strings.confirmBackup.whatBody}
        </div>
      </div>
    </Shell>
  );
}
