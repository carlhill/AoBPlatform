'use client';

/**
 * The practitioner answers an invitation.
 *
 * THE PAGE NAMES THE PRACTICE AND THE SITE BEFORE ASKING FOR ANYTHING, which
 * is the opposite of the email-verification page beside it, and the difference
 * is the whole design. That page asks somebody to confirm an address they
 * already own, so it reveals nothing until the code is right. This one asks
 * somebody to accept a working relationship — and nobody can consent to an
 * unnamed thing. Making a practitioner prove they read an email before telling
 * them what it was about would be useless and slightly sinister.
 *
 * DECLINING IS AS PROMINENT AS ACCEPTING. Same size, same row, not a link in
 * the small print. A page where declining is hard is a page that manufactures
 * consent, and consent is the only thing this platform sells. Accept carries
 * the affirmative colour because it is the affirmative act, not because it is
 * the outcome we want.
 *
 * IT SAYS WHAT ACCEPTING DOES NOT DO. A practitioner who comes away believing
 * they have signed something on a patient's behalf will not read the next thing
 * we send them — and will be badly wrong about what their name is now attached
 * to. That line gets its own weight on the page.
 *
 * AND IT DOES NOT OVERSTATE THE CEREMONY. After accepting, the page says in
 * plain words that opening an emailed link and typing a code from it proves
 * access to an inbox and not who was at the keyboard. We would rather tell a
 * practitioner that than let them believe we have proof we do not have.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Lock, ShieldCheck, ShieldX, XCircle } from 'lucide-react';
import { Button, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../invitation.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface State {
  state: string;
  canAnswer?: boolean;
  message: string;
  attemptsLeft?: number;
  summary?: string;
  consequences?: string[];
  notConsent?: string;
  practiceName?: string;
  practitionerName?: string;
  invitedByName?: string | null;
  invitedAt?: string;
}

function displayDate(value?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function InvitationView({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<State | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<'accept' | 'decline' | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/invitations/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: State) => live && setInvitation(data))
      .catch(() => live && setInvitation({ state: 'not_found', message: strings.invitation.notLoaded }));
    return () => {
      live = false;
    };
  }, [token]);

  async function answer(decision: 'accept' | 'decline') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/invitations/${token}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        throw new Error(
          Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status)),
        );
      }
      setAnswered(decision);
    } catch (e) {
      setError((e as Error).message);
      // Re-read, so the attempts remaining shown on the page is the real one
      // rather than the one from before this attempt.
      fetch(`${CORE_URL}/invitations/${token}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: State | null) => data && setInvitation(data))
        .catch(() => undefined);
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

  if (invitation === null) {
    return (
      <Shell right={strings.invitation.audience}>
        <div className={styles.card}>
          {Wordmark}
          <p className={styles.lead}>{strings.invitation.checking}</p>
        </div>
      </Shell>
    );
  }

  // --- Answered, just now ---------------------------------------------------
  if (answered) {
    const practice = invitation.practiceName ?? 'The practice';
    return (
      <Shell right={strings.invitation.audience}>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcome}>
            <div
              className={`${styles.outcomeIcon} ${answered === 'accept' ? styles.outcomeOk : styles.outcomeWarn}`}
            >
              {answered === 'accept' ? (
                <CheckCircle2 size={30} aria-hidden="true" />
              ) : (
                <XCircle size={30} aria-hidden="true" />
              )}
            </div>
            <h1 className={styles.title}>
              {answered === 'accept' ? strings.invitation.acceptedTitle : strings.invitation.declinedTitle}
            </h1>
            <p className={styles.lead}>
              {(answered === 'accept'
                ? strings.invitation.acceptedBody
                : strings.invitation.declinedBody
              ).replace('{practice}', practice)}
            </p>
            {answered === 'decline' && <p className={ui.hint}>{strings.invitation.declinedMistake}</p>}
            {/*
              Said AFTER accepting rather than before, because before it would
              be noise and afterwards it is the record. We would rather a
              practitioner know exactly what we wrote down than believe we hold
              proof we do not.
            */}
            {answered === 'accept' && <p className={styles.proves}>{strings.invitation.acceptedProves}</p>}
          </div>
        </div>
      </Shell>
    );
  }

  // --- Nothing to do --------------------------------------------------------
  if (!invitation.canAnswer) {
    const icon =
      invitation.state === 'already_accepted' ? (
        <CheckCircle2 size={30} aria-hidden="true" />
      ) : invitation.state === 'locked' ? (
        <Lock size={30} aria-hidden="true" />
      ) : invitation.state === 'expired' ? (
        <Clock size={30} aria-hidden="true" />
      ) : (
        <ShieldX size={30} aria-hidden="true" />
      );
    const tone =
      invitation.state === 'already_accepted'
        ? styles.outcomeOk
        : invitation.state === 'expired'
          ? styles.outcomeWarn
          : styles.outcomeStop;

    return (
      <Shell right={strings.invitation.audience}>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${tone}`}>{icon}</div>
            <h1 className={styles.title}>{strings.invitation.deadTitle}</h1>
            {/* The server's message, which always says what to do next. */}
            <p className={styles.lead}>{invitation.message}</p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell right={strings.invitation.audience}>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.invitation.title}</h1>

        {/* What is being agreed to, before anything is asked of the reader. */}
        <p className={styles.subject}>{invitation.summary}</p>
        <p className={styles.meta}>
          {invitation.invitedByName &&
            `${strings.invitation.invitedBy.replace('{who}', invitation.invitedByName)} `}
          {invitation.invitedAt && strings.invitation.on.replace('{when}', displayDate(invitation.invitedAt))}
        </p>

        <div className={styles.means}>
          <p className={styles.meansHead}>{strings.invitation.meansTitle}</p>
          <ul className={styles.meansList}>
            {(invitation.consequences ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/*
            From the SERVER, not the string table. The rule and its wording are
            one thing: if this page says something slightly different from the
            invitation email, a practitioner has been told two stories about
            the same limit.
          */}
          <p className={styles.notConsent}>{invitation.notConsent}</p>
        </div>

        {error && (
          <Notice tone="stop" title={strings.invitation.wrongCode}>
            {error}
          </Notice>
        )}

        <div className={styles.codeWrap}>
          <label className={styles.codeLabel} htmlFor="invitation-code">
            {strings.invitation.codeLabel}
          </label>
          <input
            id="invitation-code"
            className={`${styles.code} ${error ? styles.codeInvalid : ''}`}
            value={code}
            placeholder="------"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            data-testid="invitation-code"
          />
          <p className={styles.codeHint}>{strings.invitation.codeLead}</p>
        </div>

        {/*
          Both actions require the code, and both are disabled until it is
          complete. Declining without the code would be friendlier and would
          also let anybody holding a forwarded link destroy an invitation.
        */}
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => void answer('accept')}
            disabled={busy || code.length !== 6}
            data-testid="invitation-accept"
          >
            {busy ? strings.invitation.answering : strings.invitation.accept}
          </Button>
          <Button
            onClick={() => void answer('decline')}
            disabled={busy || code.length !== 6}
            data-testid="invitation-decline"
          >
            {strings.invitation.decline}
          </Button>
        </div>

        <div className={styles.unexpected}>
          <p className={styles.unexpectedHead}>{strings.invitation.unexpectedTitle}</p>
          <p className={ui.hint}>{strings.invitation.unexpectedBody}</p>
        </div>
      </div>
    </Shell>
  );
}
