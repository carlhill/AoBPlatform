'use client';

/**
 * Confirming an email address, in two phases.
 *
 * PHASE 1 is the link, and it deliberately does nothing. Opening this page
 * changes no state at all — which is the entire point. A bare confirmation link
 * is consumed by a GET, and plenty of things issue a GET that are not the
 * recipient: corporate mail scanners, link-preview bots, antivirus gateways,
 * and the "safe links" rewriting several mail providers apply to every URL
 * passing through them. Each would have marked an address confirmed with no
 * human involved, and the signal would have been weakest exactly where it
 * mattered most — a practice on managed corporate mail.
 *
 * PHASE 2 is the code, and it is the phase that confirms.
 *
 * ON HOW THIS LOOKS. The page asks somebody to type a code from an email, which
 * is precisely what a phishing site asks for. Looking like an organisation
 * built it is therefore not decoration: a page that looks improvised teaches
 * people that improvised-looking pages are normal, and that habit is what makes
 * phishing work. It also says WHY the code exists, because an organisation that
 * explains its own security choices reads very differently from one that does
 * not.
 *
 * What the page may show BEFORE a code is entered is almost nothing — in
 * particular not the practice name. The URL may have been forwarded, and naming
 * the practice would confirm to whoever holds the link that this entity applied
 * to us.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Lock, MailX, ShieldCheck } from 'lucide-react';
import { Button, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type State = 'live' | 'expired' | 'locked' | 'already_verified' | 'unknown';

export function VerifyView({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const readState = () =>
    fetch(`${CORE_URL}/applications/verify/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { state: State; attemptsLeft: number }) => {
        setState(data.state);
        setAttemptsLeft(Number(data.attemptsLeft));
      })
      .catch(() => setState('unknown'));

  // Declared inside the effect so it closes over `token` without becoming a
  // dependency that changes identity on every render.
  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/applications/verify/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { state: State; attemptsLeft: number }) => {
        if (!live) return;
        setState(data.state);
        setAttemptsLeft(Number(data.attemptsLeft));
      })
      .catch(() => live && setState('unknown'));
    return () => {
      live = false;
    };
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
      setCode('');
      // A wrong code has just consumed one of five attempts, and how many
      // remain is the thing the person now needs to know.
      void readState();
    } finally {
      setBusy(false);
    }
  }

  const Wordmark = (
    <div className={styles.mark}>
      <ShieldCheck size={20} aria-hidden="true" />
      <span className={styles.markText}>{strings.appName}</span>
    </div>
  );

  if (confirmed) {
    return (
      <Shell>
        <div className={styles.card}>
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${styles.outcomeOk}`}>
              <CheckCircle2 size={30} aria-hidden="true" />
            </div>
            <h1 className={styles.title}>{strings.verify.okTitle}</h1>
            <p className={styles.lead}>{strings.verify.okBody}</p>
            <p className={ui.hint}>{strings.verify.nothingElse}</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (state === null) {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <p className={styles.lead}>{strings.verify.checking}</p>
        </div>
      </Shell>
    );
  }

  if (state !== 'live') {
    const outcome =
      state === 'already_verified'
        ? { icon: <ShieldCheck size={30} aria-hidden="true" />, tone: styles.outcomeOk, title: strings.verify.alreadyTitle, body: strings.verify.alreadyBody }
        : state === 'locked'
          ? { icon: <Lock size={30} aria-hidden="true" />, tone: styles.outcomeStop, title: strings.verify.lockedTitle, body: strings.verify.lockedBody }
          : state === 'expired'
            ? { icon: <Clock size={30} aria-hidden="true" />, tone: styles.outcomeWarn, title: strings.verify.expiredTitle, body: strings.verify.expiredBody }
            : { icon: <MailX size={30} aria-hidden="true" />, tone: styles.outcomeStop, title: strings.verify.failTitle, body: strings.verify.failBody };

    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${outcome.tone}`}>{outcome.icon}</div>
            <h1 className={styles.title}>{outcome.title}</h1>
            <p className={styles.lead}>{outcome.body}</p>
          </div>
        </div>
      </Shell>
    );
  }

  const short = attemptsLeft !== null && attemptsLeft < 5;

  return (
    <Shell>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.verify.enterTitle}</h1>
        <p className={styles.lead}>{strings.verify.enterLead}</p>

        {error && (
          <Notice tone="stop" title={strings.verify.wrongCode}>
            {error}
          </Notice>
        )}

        <div className={styles.codeWrap}>
          <label className={styles.codeLabel} htmlFor="verify-code">
            {strings.verify.codeLabel}
          </label>
          <input
            id="verify-code"
            className={`${styles.code} ${error ? styles.codeInvalid : ''}`}
            value={code}
            placeholder="––––––"
            // A numeric keypad on a phone, and the one-time-code autofill some
            // clients surface straight from the message.
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            aria-describedby="verify-code-hint"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^\d{6}$/.test(code)) void submit();
            }}
            data-testid="verify-code"
          />
          <p id="verify-code-hint" className={`${styles.codeHint} ${short ? styles.codeHintWarn : ''}`}>
            {short
              ? strings.verify.attemptsLeft.replace('{n}', String(attemptsLeft))
              : strings.verify.codeHint}
          </p>
        </div>

        <Button
          variant="primary"
          className={styles.submit}
          disabled={!/^\d{6}$/.test(code) || busy}
          onClick={submit}
          data-testid="verify-submit"
        >
          {busy ? strings.verify.confirming : strings.verify.confirm}
        </Button>

        <div className={styles.why}>
          <div className={styles.whyHead}>
            <ShieldCheck size={16} aria-hidden="true" />
            {strings.verify.whyHeading}
          </div>
          {strings.verify.whyCode}
        </div>

        <p className={styles.assurance}>{strings.verify.assurance}</p>
      </div>
    </Shell>
  );
}
