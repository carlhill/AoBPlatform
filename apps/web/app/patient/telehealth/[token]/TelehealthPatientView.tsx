'use client';

/**
 * THE ONE PAGE FOR A TELEHEALTH CONSULTATION (TELEHEALTH-PLAN.md §3 steps 6–9;
 * decision 4: one page for the whole consultation).
 *
 * THE PATIENT IS ON A CALL, OFTEN ON THIS SAME PHONE (§5c C9). So the page is
 * short, the controls are large, the code box asks the phone for its numeric
 * keypad and accepts a pasted code, and every refusal says what to ask the
 * practitioner on the call — the one person who can fix it right now.
 *
 * WHAT IT SHOWS, IN ORDER: the practice (before the code, and nothing else —
 * content-blind, REQ-CHILD-04), the code box, then the practice and the
 * practitioner and ONE statement as ONE button, then "waiting for …".
 *
 * THE STATEMENT IS THE SERVER'S, from versioned content, and the page sends
 * back only its key. What is recorded is what was shown (hard rule 14). It is
 * about the consultation only until G10 is answered.
 *
 * THE PAGE KEY LIVES IN MEMORY ONLY. Nothing is written to any browser
 * storage: a closed page is reopened by a fresh link and code from the
 * practitioner (§3 "If the page was closed"), not by something left behind on
 * the phone.
 *
 * STEP 3 SEAM. The waiting state polls the page; when the DB4 can be sent to
 * it, it arrives through the same poll and renders where `telehealth-waiting`
 * is now.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { TELEHEALTH_CONTENT } from '@aobplatform/domain';
import type { TelehealthLinkLanding, TelehealthPageView } from '@aobplatform/contracts';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../../ui';
import { strings } from '../../../strings';
import { useLiveRefresh } from '../../../useLiveRefresh';
import styles from './telehealth.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const t = strings.telehealth.patient;
/** From versioned content (hard rule 14), never a literal. */
const DIGITS = TELEHEALTH_CONTENT.code.digits;

/** Each maps to words that say what to do next. There is no generic fallback. */
type Stop = 'invalid' | 'unreachable' | 'used' | 'expired' | 'locked' | 'closed';

const stopWords: Record<Stop, { title: string; body: string; tone: 'warn' | 'stop' }> = {
  invalid: { title: t.invalidTitle, body: t.invalidBody, tone: 'warn' },
  unreachable: { title: t.unreachableTitle, body: t.unreachableBody, tone: 'warn' },
  used: { title: t.usedTitle, body: t.usedBody, tone: 'warn' },
  expired: { title: t.expiredTitle, body: t.expiredBody, tone: 'warn' },
  locked: { title: t.lockedTitle, body: t.lockedBody, tone: 'stop' },
  closed: { title: t.closedTitle, body: t.closedBody, tone: 'warn' },
};

export function TelehealthPatientView({ token }: { token: string }) {
  const [landing, setLanding] = useState<TelehealthLinkLanding | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [page, setPage] = useState<TelehealthPageView | null>(null);
  const [agreeError, setAgreeError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${CORE_URL}/telehealth/link/${encodeURIComponent(token)}`).catch(() => null);
      if (!res) return setStop('unreachable');
      if (!res.ok) return setStop('invalid');
      const body = (await res.json()) as TelehealthLinkLanding;
      setLanding(body);
      if (body.state !== 'open') setStop(body.state);
    })();
  }, [token]);

  const loadPage = useCallback(async (key: string) => {
    const res = await fetch(`${CORE_URL}/telehealth/page`, { headers: { 'x-telehealth-page-key': key } }).catch(() => null);
    if (!res) return setStop('unreachable');
    if (!res.ok) return setStop(res.status === 410 ? 'expired' : 'invalid');
    setPage((await res.json()) as TelehealthPageView);
  }, []);

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length === 0) return;
    setBusy(true);
    setCodeError(null);
    try {
      const res = await fetch(`${CORE_URL}/telehealth/link/${encodeURIComponent(token)}/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: digits }),
      }).catch(() => null);
      if (!res) return setStop('unreachable');
      const body = (await res.json().catch(() => ({}))) as { pageKey?: string; attemptsLeft?: number | null };
      if (res.ok && body.pageKey) {
        setPageKey(body.pageKey);
        await loadPage(body.pageKey);
        return;
      }
      if (res.status === 423) return setStop('locked');
      if (res.status === 410) return setStop('expired');
      if (res.status === 404) return setStop('invalid');
      setCode('');
      setCodeError(t.wrongCode(body.attemptsLeft ?? 0));
    } finally {
      setBusy(false);
    }
  };

  const agree = async () => {
    if (!pageKey || !page) return;
    setBusy(true);
    setAgreeError(null);
    try {
      const res = await fetch(`${CORE_URL}/telehealth/page/agree`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telehealth-page-key': pageKey },
        body: JSON.stringify({ consentKey: page.consentKey }),
      }).catch(() => null);
      if (!res) return setStop('unreachable');
      if (res.status === 409) return setAgreeError(t.wordingChanged);
      if (!res.ok) return setStop(res.status === 410 ? 'expired' : 'invalid');
      setPage((await res.json()) as TelehealthPageView);
    } finally {
      setBusy(false);
    }
  };

  // The page stays open after agreeing; it re-reads so whatever arrives next shows here (step 3).
  useLiveRefresh(Boolean(pageKey && page && page.state === 'agreed'), () => (pageKey ? loadPage(pageKey) : undefined));

  const practiceLine = (name: string | null | undefined) =>
    name ? (
      <p className={styles.practice} data-testid="telehealth-practice">
        <ShieldCheck size={20} aria-hidden="true" /> {t.fromPractice(name)}
      </p>
    ) : null;

  if (stop) {
    const words = stopWords[stop];
    return (
      <Shell title={t.title}>
        {practiceLine(landing?.practiceName)}
        <Notice tone={words.tone} title={words.title} data-testid={`telehealth-${stop}`}>
          {words.body}
        </Notice>
      </Shell>
    );
  }

  if (page) {
    const provider = page.providerName ?? '';
    return (
      <Shell title={t.title}>
        {practiceLine(page.practiceName)}
        {page.state === 'code_checked' && (
          <section className={styles.card} aria-labelledby="telehealth-with">
            <h2 id="telehealth-with" className={styles.heading}>
              {t.withProvider(provider)}
            </h2>
            {agreeError && <Notice tone="warn">{agreeError}</Notice>}
            {/* The Button's own class is fixed, so the size lives on a wrapper. */}
            <div className={styles.big}>
              <Button variant="primary" onClick={() => void agree()} disabled={busy} data-testid="telehealth-agree">
                {busy ? t.sending : page.statement}
              </Button>
            </div>
          </section>
        )}
        {page.state === 'agreed' && (
          <section className={styles.card} data-testid="telehealth-waiting" aria-live="polite">
            <h2 className={styles.heading}>{t.waitingTitle(provider)}</h2>
            <p>{t.waitingBody}</p>
          </section>
        )}
        {page.state === 'not_done' && (
          <Notice tone="ok" title={t.notDoneTitle} data-testid="telehealth-not-done">
            {t.notDoneBody}
          </Notice>
        )}
        {page.state === 'did_not_proceed' && (
          <Notice tone="warn" title={t.didNotProceedTitle} data-testid="telehealth-did-not-proceed">
            {t.didNotProceedBody}
          </Notice>
        )}
      </Shell>
    );
  }

  if (!landing) {
    return (
      <Shell title={t.title}>
        <p className={ui.hint} data-testid="telehealth-loading">
          {t.loading}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={t.title}>
      {practiceLine(landing.practiceName)}
      <form className={styles.card} onSubmit={(e) => void submitCode(e)} aria-labelledby="telehealth-code-heading">
        <h2 id="telehealth-code-heading" className={styles.heading}>
          {t.codeHeading}
        </h2>
        <p>{t.codeLede(DIGITS)}</p>
        <div className={styles.code}>
        <Field label={t.codeLabel} hint={t.codeHint} error={codeError}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={DIGITS}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, DIGITS))}
              data-testid="telehealth-code"
            />
          )}
        </Field>
        </div>
        <div className={styles.big}>
          <Button type="submit" variant="primary" disabled={busy} data-testid="telehealth-continue">
            {busy ? t.checking : t.continue}
          </Button>
        </div>
      </form>
    </Shell>
  );
}
