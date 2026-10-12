'use client';

/**
 * "Stop this change" — the page the warning links to.
 *
 * Sent to the OLD administrator address and the group address, because those
 * are the channels the person requesting the change does not control BY HAVING
 * MADE THE REQUEST. This page is the alarm's off switch, and it is the reason
 * the warning is worth sending at all.
 *
 * STILL A BUTTON, NOT A BARE LINK. Stopping is the safe direction and takes
 * one press — nobody should have to type a code to say "this was not me" — but
 * a mail scanner following the link must not cancel a legitimate change on the
 * practice's behalf. So arriving here does nothing; pressing does.
 *
 * It works after the request has expired, too. Somebody reading the warning a
 * week late must still be able to object; refusing them would give the alarm a
 * shorter life than the thing it warns about.
 *
 * DRESSED LIKE THE OTHER TWO EMAIL-ACTION PAGES (/verify,
 * /practice/confirm-email, /practice/confirm-backup) even though this one asks
 * for no code — a stranger arriving from an email to press a security-relevant
 * button deserves the same "built by an organisation" look, not a plainer one
 * because the interaction is simpler.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, Notice, Shell } from '../../ui';
import { strings } from '../../strings';
import styles from '../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function StopEmailChangeView() {
  const token = useSearchParams().get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const Wordmark = (
    <div className={styles.mark}>
      <ShieldCheck size={20} aria-hidden="true" />
      <span className={styles.markText}>{strings.appName}</span>
    </div>
  );

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/pending-email-change/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be stopped (${res.status}).`);
      setDone(body.detail ?? strings.stopEmail.doneFallback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <h1 className={styles.title}>{strings.stopEmail.title}</h1>
          <Notice tone="stop" title={strings.stopEmail.noTokenTitle}>
            {strings.stopEmail.noTokenBody}
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
          <h1 className={styles.title}>{strings.stopEmail.doneTitle}</h1>
          <p className={styles.lead}>{done}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.stopEmail.title}</h1>
        <p className={styles.lead}>{strings.stopEmail.lead}</p>

        {error && (
          <Notice tone="stop" title={strings.stopEmail.failed}>
            {error}
          </Notice>
        )}

        <Button
          variant="primary"
          className={styles.submit}
          onClick={() => void stop()}
          disabled={busy}
          data-testid="stop-submit"
        >
          <ShieldAlert size={14} aria-hidden="true" />
          {busy ? strings.stopEmail.stopping : strings.stopEmail.stop}
        </Button>

        <div className={styles.why}>
          <div className={styles.whyHead}>
            <ShieldAlert size={16} aria-hidden="true" />
            {strings.stopEmail.ifItWasYouTitle}
          </div>
          {strings.stopEmail.ifItWasYouBody}
        </div>
      </div>
    </Shell>
  );
}
