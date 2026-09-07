'use client';

/**
 * A patient approving their bulk-billing agreement, from the link we sent.
 *
 * THREE SCREENS, IN AN ORDER THAT MATTERS.
 *
 *   1. PROVE WHO YOU ARE. Opening the link shows nothing about anybody — not
 *      the practice, not the doctor, not the patient's name (REQ-CHILD-04).
 *      Links get forwarded, previewed and scanned; whoever holds one must
 *      learn nothing until they have stated the three things only the patient
 *      knows. The server compares and discards the values (REQ-VER-04).
 *   2. READ WHAT YOU ARE AGREEING TO. Now, and only now, the agreement: the
 *      practice, the practitioner, the date, the item numbers. NO DOLLAR
 *      AMOUNT — Rule 4 applies to this screen as it does to the artefact.
 *      The particulars are locked and hashed on this read, so what is shown
 *      is exactly what the signature binds to.
 *   3. SAY YES. One tap. The signature event, validation, storage and the
 *      write-back to the practice's system all happen on the server, in the
 *      same path a signature at the desk takes.
 *
 * ON HOW THIS LOOKS. Same reasoning as the email-confirmation page: this asks a
 * person to type their date of birth and address into a page they reached
 * from a message — precisely what a phishing site does. Looking like an
 * organisation built it, and saying WHY each step exists, is what separates
 * the two.
 *
 * NO ACCOUNT, EVER (REQ-PORT-08). There is nothing to sign in to.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileCheck2, Lock, MailX, ShieldCheck, Wrench } from 'lucide-react';
import { Button, Checkbox, Notice, Shell, ui } from '../../../ui';
import { strings } from '../../../strings';
import styles from '../../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Stage = 'loading' | 'challenge' | 'ready' | 'blocked' | 'done';
type Outcome = 'invalid' | 'expired' | 'locked' | 'unreachable';

/** One thing the person ticks. The KEY is what the signature records. */
type Statement = { key: string; text: string };

type Particulars = {
  practiceName: string | null;
  providerName: string | null;
  agreementType: string;
  agreementDate: string;
  serviceDate: string;
  mbsItemNumbers: string[];
  patientName: string;
  artefactSha256: string | null;
};

function niceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function AgreeView({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [identifierTypes, setIdentifierTypes] = useState<string[]>([]);
  const [particulars, setParticulars] = useState<Particulars | null>(null);
  /**
   * THE STATEMENTS THE PERSON TICKS, and the ones they have (Carl, 5 Sep 2026;
   * W1). The sentences come from the server as part of the rendered document —
   * the same object the PDF was drawn from and hashed against — so this page
   * and the contract cannot say different things.
   *
   * THE REMOTE LINK IS NOT A LESSER SURFACE. The server refuses a signature
   * that does not carry every statement key of the template the agreement was
   * rendered from, whatever the channel. Empty on an agreement locked before
   * templates existed, and the page then behaves exactly as it did.
   */
  const [statements, setStatements] = useState<readonly Statement[]>([]);
  const [affirmed, setAffirmed] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the copy has already landed in the practice's system, or is on
  // its way. The done screen says which, because they are not the same claim.
  const [writtenBack, setWrittenBack] = useState(false);

  // What the person states. Held only in component state and sent once.
  const [familyName, setFamilyName] = useState('');
  const [givenNames, setGivenNames] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');

  const fail = (status: number) => {
    if (status === 404) setOutcome('invalid');
    else if (status === 410) setOutcome('expired');
    else if (status === 423) setOutcome('locked');
    else setOutcome('unreachable');
  };

  /** Screen 2: what they are agreeing to. Locks on the server. */
  const loadAgreement = useCallback(async () => {
    const res = await fetch(`${CORE_URL}/agree/${token}`).catch(() => null);
    if (!res) return setOutcome('unreachable');
    if (res.status === 501) return setStage('blocked');
    if (!res.ok) return fail(res.status);
    const body = (await res.json()) as { particulars: Particulars; statements?: readonly Statement[] };
    setParticulars(body.particulars);
    setStatements(body.statements ?? []);
    setAffirmed([]);
    setStage('ready');
  }, [token]);

  // Screen 1: open the link. Content-blind — we learn only which identifiers to ask for.
  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/capture/link/${token}`)
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) return fail(r.status);
        const body = (await r.json()) as { identifierTypes: string[] };
        setIdentifierTypes(body.identifierTypes ?? []);
        setStage('challenge');
      })
      .catch(() => live && setOutcome('unreachable'));
    return () => {
      live = false;
    };
  }, [token]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const stated: Record<string, string> = {};
      // The server holds the name as "family given" — the same shape the
      // practice's own system uses — so it is composed here in that order.
      if (identifierTypes.includes('name')) stated.name = `${familyName.trim()} ${givenNames.trim()}`.trim();
      if (identifierTypes.includes('date_of_birth')) stated.date_of_birth = dateOfBirth;
      if (identifierTypes.includes('address')) stated.address = address.trim();

      const res = await fetch(`${CORE_URL}/capture/link/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stated }),
      });
      if (!res.ok) return fail(res.status);
      const result = (await res.json()) as { outcome: 'passed' | 'failed' | 'locked_out'; message?: string };
      if (result.outcome === 'passed') {
        setFamilyName('');
        setGivenNames('');
        setDateOfBirth('');
        setAddress('');
        await loadAgreement();
      } else if (result.outcome === 'locked_out') {
        setOutcome('locked');
      } else {
        setError(result.message ?? strings.agree.mismatch);
      }
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/agree/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tap_to_approve', affirmations: affirmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (res.status === 404 || res.status === 410 || res.status === 423) return fail(res.status);
        throw new Error(body.message ?? strings.agree.approveFailed);
      }
      const outcome = (await res.json().catch(() => ({}))) as { writtenBack?: boolean };
      setWrittenBack(Boolean(outcome.writtenBack));
      setStage('done');
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
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

  if (outcome) {
    const o =
      outcome === 'locked'
        ? { icon: <Lock size={30} aria-hidden="true" />, tone: styles.outcomeStop, title: strings.agree.lockedTitle, body: strings.agree.lockedBody }
        : outcome === 'expired'
          ? { icon: <Clock size={30} aria-hidden="true" />, tone: styles.outcomeWarn, title: strings.agree.expiredTitle, body: strings.agree.expiredBody }
          : outcome === 'unreachable'
            ? { icon: <MailX size={30} aria-hidden="true" />, tone: styles.outcomeWarn, title: strings.agree.unreachableTitle, body: strings.status.unreachable }
            : { icon: <MailX size={30} aria-hidden="true" />, tone: styles.outcomeStop, title: strings.agree.invalidTitle, body: strings.agree.invalidBody };
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${o.tone}`}>{o.icon}</div>
            <h1 className={styles.title}>{o.title}</h1>
            <p className={styles.lead}>{o.body}</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <div className={styles.card}>
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${styles.outcomeOk}`}>
              <CheckCircle2 size={30} aria-hidden="true" />
            </div>
            <h1 className={styles.title}>{strings.agree.doneTitle}</h1>
            <p className={styles.lead}>{writtenBack ? strings.agree.doneBody : strings.agree.doneBodyPending}</p>
            <p className={ui.hint}>{strings.agree.nothingElse}</p>
            {/* Their half of the log (P-1, Messages). The same link they hold
                already, so nothing new to keep. */}
            <a className={ui.buttonLink} href={`/patient/messages/${token}`} data-testid="agree-messages-link">
              {strings.agree.messagesLink}
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'blocked') {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <div className={styles.outcome}>
            <div className={`${styles.outcomeIcon} ${styles.outcomeWarn}`}>
              <Wrench size={30} aria-hidden="true" />
            </div>
            <h1 className={styles.title}>{strings.agree.blockedTitle}</h1>
            <p className={styles.lead}>{strings.agree.blockedBody}</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'loading') {
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <p className={styles.lead}>{strings.agree.checking}</p>
        </div>
      </Shell>
    );
  }

  if (stage === 'ready' && particulars) {
    const items = particulars.mbsItemNumbers.join(', ');
    /*
     * EVERY STATEMENT, OR APPROVE STAYS SHUT, and the count is in the label —
     * the boxes are on the same screen, so the count IS the direction
     * (CLAUDE.md §7). The server holds the same line whatever this does.
     */
    const outstanding = statements.filter((statement) => !affirmed.includes(statement.key)).length;
    return (
      <Shell>
        <div className={styles.card}>
          {Wordmark}
          <h1 className={styles.title}>{strings.agree.reviewTitle}</h1>
          <p className={styles.lead}>{strings.agree.reviewLead}</p>

          {error && (
            <Notice tone="stop" title={strings.agree.approveFailed}>
              {error}
            </Notice>
          )}

          <dl className={ui.facts} data-testid="agree-particulars">
            <dt>{strings.agree.patient}</dt>
            <dd>{particulars.patientName}</dd>
            <dt>{strings.agree.practice}</dt>
            <dd>{particulars.practiceName ?? '—'}</dd>
            <dt>{strings.agree.practitioner}</dt>
            <dd>{particulars.providerName ?? '—'}</dd>
            <dt>{strings.agree.serviceDate}</dt>
            <dd>{niceDate(particulars.serviceDate)}</dd>
            <dt>{particulars.mbsItemNumbers.length === 1 ? strings.agree.item : strings.agree.items}</dt>
            <dd className={ui.mono}>{items || '—'}</dd>
          </dl>

          <p className={ui.hint}>{strings.agree.noAmount}</p>

          {/*
            THE OPERATIVE WORDS, FROM THE SERVER. Not written in this file and
            not in the string table: a sentence here would be a second copy of
            the words of a contract, free to drift from the one that was
            signed. The heading around them is chrome and IS in the table.
          */}
          {statements.length > 0 && (
            <div data-testid="agree-statements">
              <p className={ui.hint}>{strings.agree.statementsHeading}</p>
              {statements.map((statement) => (
                <Checkbox
                  key={statement.key}
                  checked={affirmed.includes(statement.key)}
                  onCheckedChange={(on) =>
                    setAffirmed((current) =>
                      on ? [...current, statement.key] : current.filter((k) => k !== statement.key),
                    )
                  }
                  label={statement.text}
                />
              ))}
            </div>
          )}

          <Button
            variant="primary"
            className={styles.submit}
            disabled={busy || outstanding > 0}
            onClick={approve}
            data-testid="agree-approve"
          >
            <FileCheck2 size={16} aria-hidden="true" />
            {busy
              ? strings.agree.approving
              : outstanding > 0
                ? strings.agree.approveNotAffirmed(outstanding)
                : strings.agree.approve}
          </Button>

          <div className={styles.why}>
            <div className={styles.whyHead}>
              <ShieldCheck size={16} aria-hidden="true" />
              {strings.agree.whyApproveHeading}
            </div>
            {strings.agree.whyApprove}
          </div>
          {particulars.artefactSha256 && (
            <p className={styles.assurance}>
              {strings.agree.recordRef} <span className={ui.mono}>{particulars.artefactSha256.slice(0, 16)}</span>
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // stage === 'challenge'
  const canSubmit =
    (!identifierTypes.includes('name') || (familyName.trim() && givenNames.trim())) &&
    (!identifierTypes.includes('date_of_birth') || /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) &&
    (!identifierTypes.includes('address') || address.trim().length > 3);

  return (
    <Shell>
      <div className={styles.card}>
        {Wordmark}
        <h1 className={styles.title}>{strings.agree.verifyTitle}</h1>
        <p className={styles.lead}>{strings.agree.verifyLead}</p>

        {error && (
          <Notice tone="stop" title={strings.agree.mismatchTitle}>
            {error}
          </Notice>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) void verify();
          }}
        >
          {identifierTypes.includes('name') && (
            <>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="agree-family">
                  {strings.agree.familyName}
                </label>
                <input
                  id="agree-family"
                  className={ui.input}
                  value={familyName}
                  autoComplete="family-name"
                  autoFocus
                  onChange={(e) => setFamilyName(e.target.value)}
                  data-testid="agree-family"
                />
              </div>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="agree-given">
                  {strings.agree.givenNames}
                </label>
                <input
                  id="agree-given"
                  className={ui.input}
                  value={givenNames}
                  autoComplete="given-name"
                  onChange={(e) => setGivenNames(e.target.value)}
                  data-testid="agree-given"
                />
              </div>
            </>
          )}
          {identifierTypes.includes('date_of_birth') && (
            <div className={ui.field}>
              <label className={ui.label} htmlFor="agree-dob">
                {strings.agree.dateOfBirth}
              </label>
              <input
                id="agree-dob"
                className={ui.input}
                type="date"
                value={dateOfBirth}
                autoComplete="bday"
                onChange={(e) => setDateOfBirth(e.target.value)}
                data-testid="agree-dob"
              />
            </div>
          )}
          {identifierTypes.includes('address') && (
            <div className={ui.field}>
              <label className={ui.label} htmlFor="agree-address">
                {strings.agree.address}
              </label>
              <input
                id="agree-address"
                className={ui.input}
                value={address}
                autoComplete="street-address"
                onChange={(e) => setAddress(e.target.value)}
                data-testid="agree-address"
              />
              <p className={ui.hint}>{strings.agree.addressHint}</p>
            </div>
          )}

          <Button variant="primary" className={styles.submit} disabled={!canSubmit || busy} type="submit" data-testid="agree-verify">
            {busy ? strings.agree.verifying : strings.agree.verify}
          </Button>
        </form>

        <div className={styles.why}>
          <div className={styles.whyHead}>
            <ShieldCheck size={16} aria-hidden="true" />
            {strings.agree.whyVerifyHeading}
          </div>
          {strings.agree.whyVerify}
        </div>

        <p className={styles.assurance}>{strings.agree.assurance}</p>
      </div>
    </Shell>
  );
}
