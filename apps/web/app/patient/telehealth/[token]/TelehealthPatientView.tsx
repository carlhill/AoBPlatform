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
import { CircleCheck, ShieldCheck } from 'lucide-react';
import {
  TELEHEALTH_CONSENTER_NAME_SLOT,
  TELEHEALTH_CONTENT,
  isPlausibleConsenterName,
  isWellFormedMobile,
} from '@aobplatform/domain';
import type { TelehealthLinkLanding, TelehealthPageView } from '@aobplatform/contracts';
import { Button, Checkbox, Field, Notice, Shell, TextInput, ui } from '../../../ui';
import { strings } from '../../../strings';
import { useLiveRefresh } from '../../../useLiveRefresh';
import styles from './telehealth.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const t = strings.telehealth.patient;
/** Ahpra's public register search page, where anyone can look up a registration number. */
const AHPRA_REGISTER_URL = 'https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx';
/** From versioned content (hard rule 14), never a literal. */
const DIGITS = TELEHEALTH_CONTENT.code.digits;

/** Each maps to words that say what to do next. There is no generic fallback. */
type Stop =
  | 'invalid'
  | 'unreachable'
  | 'used'
  | 'expired'
  | 'locked'
  | 'closed'
  | 'replaced'
  | 'page-expired'
  | 'page-not-open'
  | 'unmapped';

const stopWords: Record<Stop, { title: string; body: string; tone: 'warn' | 'stop' }> = {
  invalid: { title: t.invalidTitle, body: t.invalidBody, tone: 'warn' },
  unreachable: { title: t.unreachableTitle, body: t.unreachableBody, tone: 'warn' },
  used: { title: t.usedTitle, body: t.usedBody, tone: 'warn' },
  expired: { title: t.expiredTitle, body: t.expiredBody, tone: 'warn' },
  locked: { title: t.lockedTitle, body: t.lockedBody, tone: 'stop' },
  closed: { title: t.closedTitle, body: t.closedBody, tone: 'warn' },
  replaced: { title: t.replacedTitle, body: t.replacedBody, tone: 'warn' },
  'page-expired': { title: t.pageExpiredTitle, body: t.pageExpiredBody, tone: 'warn' },
  'page-not-open': { title: t.pageNotOpenTitle, body: t.pageNotOpenBody, tone: 'warn' },
  unmapped: { title: t.unmappedTitle, body: '', tone: 'warn' },
};

/** The server's reason codes, and the words each one gets (TELEHEALTH_ROUTES in contracts). */
const STOP_FOR_CODE: Record<string, Stop> = {
  link_invalid: 'invalid',
  link_used: 'used',
  code_expired: 'expired',
  session_closed: 'closed',
  locked: 'locked',
  page_replaced: 'replaced',
  page_expired: 'page-expired',
  page_not_open: 'page-not-open',
};

/**
 * WHAT A REFUSAL MEANS, FROM ITS CODE — NEVER FROM THE STATUS ALONE (wow.md
 * §13). A 410 can be a used link, a lapsed code, a closed page or a newer link,
 * and each needs different words. The status decides only what no code can:
 * the server was not there (5xx). A code with no words shows the code.
 */
export function refusalFor(status: number, code: string | undefined): { stop: Stop; code?: string } {
  if (status >= 500) return { stop: 'unreachable' };
  if (code && STOP_FOR_CODE[code]) return { stop: STOP_FOR_CODE[code] };
  return { stop: 'unmapped', code: code ?? `HTTP ${status}` };
}

async function codeOf(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { code?: unknown };
  return typeof body.code === 'string' ? body.code : undefined;
}

export function TelehealthPatientView({ token }: { token: string }) {
  const [landing, setLanding] = useState<TelehealthLinkLanding | null>(null);
  const [stop, setStopState] = useState<Stop | null>(null);
  const [unmappedCode, setUnmappedCode] = useState<string | null>(null);
  const setStop = (next: Stop) => setStopState(next);
  const refuse = (status: number, code: string | undefined) => {
    const r = refusalFor(status, code);
    if (r.code) setUnmappedCode(r.code);
    setStopState(r.stop);
  };
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [page, setPage] = useState<TelehealthPageView | null>(null);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  /** The patient's own tick beside the statement; Start stays off until it is ticked. */
  const [ticked, setTicked] = useState(false);
  /** Someone acting for the patient names themselves and gives a mobile before the tick (D-2026-10-12-03 item 12). */
  const [consenterName, setConsenterName] = useState('');
  const [consenterMobile, setConsenterMobile] = useState('');
  /** Left once, so a field still being typed is never called wrong (Carl, 12 Oct 2026). */
  const [nameTouched, setNameTouched] = useState(false);
  const [mobileTouched, setMobileTouched] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${CORE_URL}/telehealth/link/${encodeURIComponent(token)}`).catch(() => null);
      if (!res) return setStop('unreachable');
      if (!res.ok) return refuse(res.status, await codeOf(res));
      const body = (await res.json()) as TelehealthLinkLanding;
      setLanding(body);
      if (body.state !== 'open') setStop(body.state);
    })();
  }, [token]);

  const loadPage = useCallback(async (key: string) => {
    const res = await fetch(`${CORE_URL}/telehealth/page`, { headers: { 'x-telehealth-page-key': key } }).catch(() => null);
    if (!res) return setStopState('unreachable');
    if (!res.ok) {
      const r = refusalFor(res.status, await codeOf(res));
      if (r.code) setUnmappedCode(r.code);
      return setStopState(r.stop);
    }
    setPage((await res.json()) as TelehealthPageView);
  }, []);

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, '');
    // Every digit, or nothing is sent: a short code is a guess the lockout would count.
    if (digits.length !== DIGITS) return;
    setBusy(true);
    setCodeError(null);
    try {
      const res = await fetch(`${CORE_URL}/telehealth/link/${encodeURIComponent(token)}/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: digits }),
      }).catch(() => null);
      if (!res) return setStop('unreachable');
      const body = (await res.json().catch(() => ({}))) as { pageKey?: string; attemptsLeft?: number | null; code?: string };
      if (res.ok && body.pageKey) {
        setPageKey(body.pageKey);
        await loadPage(body.pageKey);
        return;
      }
      if (res.status < 500 && body.code === 'wrong_code') {
        setCode('');
        // A count only when the server gave one; never "0 more tries" from a missing number.
        setCodeError(typeof body.attemptsLeft === 'number' && body.attemptsLeft > 0 ? t.wrongCode(body.attemptsLeft) : t.wrongCodeNoCount);
        return;
      }
      refuse(res.status, typeof body.code === 'string' ? body.code : undefined);
    } finally {
      setBusy(false);
    }
  };

  const agree = async () => {
    if (!pageKey || !page) return;
    setBusy(true);
    setAgreeError(null);
    let recorded = false;
    try {
      const res = await fetch(`${CORE_URL}/telehealth/page/agree`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telehealth-page-key': pageKey },
        body: JSON.stringify({
          consentKey: page.consentKey,
          ...(page.consenterIsPatient ? {} : { consenterName: consenterName.trim(), consenterMobile: consenterMobile.trim() }),
        }),
      }).catch(() => null);
      if (!res) return setStop('unreachable');
      if (!res.ok) {
        const code = await codeOf(res);
        if (code === 'wording_changed') return setAgreeError(t.wordingChanged);
        if (code === 'consenter_name_needed') return setAgreeError(t.consenterNameNeeded);
        if (code === 'consenter_mobile_needed') return setAgreeError(t.consenterMobileNeeded);
        // The practitioner recorded the consultation meanwhile: show what they recorded.
        if (code === 'session_not_done' || code === 'session_did_not_proceed' || code === 'session_went_ahead') return loadPage(pageKey);
        return refuse(res.status, code);
      }
      setPage((await res.json()) as TelehealthPageView);
      recorded = true;
    } finally {
      setBusy(false);
      // Any way out but a recorded agreement takes the tick off again.
      if (!recorded) setTicked(false);
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
          {stop === 'unmapped'
            ? t.unmappedBody(unmappedCode ?? '')
            : stop === 'closed'
              ? t.closedBodyFor(landing?.outcome ?? null)
              : words.body}
        </Notice>
      </Shell>
    );
  }

  if (page) {
    const provider = page.providerName ?? '';
    // The tick waits for a full name and a mobile from someone acting for the patient; the patient needs neither.
    const nameOk = isPlausibleConsenterName(consenterName);
    const mobileOk = isWellFormedMobile(consenterMobile);
    const consenterReady = page.consenterIsPatient || (nameOk && mobileOk);
    /* A green tick in a circle once a field is right, and words, not colour alone, once a wrong one is left (Carl, 12 Oct 2026). */
    const okMark = (ok: boolean, testId: string) =>
      ok ? <CircleCheck size={20} className={styles.okMark} aria-label={t.fieldOk} data-testid={testId} /> : null;
    /*
     * WHO THE PROVIDER IS, AND WHERE TO CHECK (Carl, D-2026-10-12-03 item 10):
     * only when core says the registration was sighted and is current. The
     * site is named in the text so a careful reader can type it themselves.
     */
    const ahpraLine = page.ahpraNumber ? (
      <p data-testid="telehealth-ahpra">
        {t.ahpraLine(provider, page.ahpraNumber)}{' '}
        <a href={AHPRA_REGISTER_URL} target="_blank" rel="noopener noreferrer">
          {t.ahpraSite}
        </a>
        .
      </p>
    ) : null;
    return (
      <Shell title={t.title}>
        {practiceLine(page.practiceName)}
        {page.state === 'code_checked' && (
          <section className={styles.card} aria-labelledby="telehealth-with">
            <h2 id="telehealth-with" className={styles.heading}>
              {/* The provider's name on a line of its own (Carl, 12 Oct 2026). */}
              {t.withProviderLead}
              <br />
              {provider}
            </h2>
            {ahpraLine}
            {agreeError && <Notice tone="warn">{agreeError}</Notice>}
            {/*
             * ONE STEP: THE TICK IS THE AGREEMENT (Carl, 12 Oct 2026). The
             * statement is the tick box's label, from the versioned content;
             * ticking it sends it, and the page turns into the green "has
             * started" box. If the send fails the tick comes off again, so the
             * box never shows agreement that was not recorded.
             */}
            {!page.consenterIsPatient && (
              <>
                <p data-testid="telehealth-consenter-intro">
                  {t.consenterIntro(
                    TELEHEALTH_CONTENT.consent.relationshipPhrases[page.consenterRelationship ?? ''] ?? TELEHEALTH_CONTENT.consent.relationshipPhrases.other,
                    page.patientGivenNames ?? '',
                  )}
                </p>
                <Field
                  label={
                    <span className={styles.labelRow}>
                      {t.consenterNameLabel} {okMark(nameOk, 'telehealth-name-ok')}
                    </span>
                  }
                  hint={t.consenterNameHint}
                  error={nameTouched && !nameOk && consenterName.trim() ? t.consenterNameNeeded : null}
                >
                  {({ id, describedBy }) => (
                    <TextInput
                      id={id}
                      describedBy={describedBy}
                      value={consenterName}
                      autoComplete="name"
                      maxLength={100}
                      onChange={(e) => setConsenterName(e.target.value)}
                      onBlur={() => setNameTouched(true)}
                      data-testid="telehealth-consenter-name"
                    />
                  )}
                </Field>
                <Field
                  label={
                    <span className={styles.labelRow}>
                      {t.consenterMobileLabel} {okMark(mobileOk, 'telehealth-mobile-ok')}
                    </span>
                  }
                  hint={t.consenterMobileHint}
                  error={mobileTouched && !mobileOk && consenterMobile.trim() ? t.consenterMobileNeeded : null}
                >
                  {({ id, describedBy }) => (
                    <TextInput
                      id={id}
                      describedBy={describedBy}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={20}
                      value={consenterMobile}
                      onChange={(e) => setConsenterMobile(e.target.value)}
                      onBlur={() => setMobileTouched(true)}
                      data-testid="telehealth-consenter-mobile"
                    />
                  )}
                </Field>
              </>
            )}
            <div className={styles.tick}>
              <Checkbox
                label={page.statement.replace(TELEHEALTH_CONSENTER_NAME_SLOT, consenterName.trim() || t.consenterNameSlot)}
                checked={ticked}
                disabled={busy || !consenterReady}
                onCheckedChange={(on) => {
                  if (!on || busy) return;
                  setTicked(true);
                  void agree();
                }}
                testId="telehealth-tick"
              />
            </div>
            {busy && <p aria-live="polite">{t.sending}</p>}
          </section>
        )}
        {page.state === 'agreed' && (
          <section className={`${styles.card} ${styles.started}`} data-testid="telehealth-waiting" aria-live="polite">
            <h2 className={styles.heading}>{t.started(page.greetingName)}</h2>
            <p>{t.waitingBody}</p>
            {ahpraLine}
          </section>
        )}
        {page.state === 'not_done' && (
          <Notice tone="ok" title={t.notDoneTitle} data-testid="telehealth-not-done">
            {t.notDoneBody}
          </Notice>
        )}
        {page.state === 'went_ahead' && (
          <section className={`${styles.card} ${styles.started}`} data-testid="telehealth-complete" aria-live="polite">
            <h2 className={styles.heading}>{t.completeTitle(page.greetingName)}</h2>
            <p>{t.completeBody}</p>
            {ahpraLine}
          </section>
        )}
        {page.state === 'did_not_proceed' && (
          <Notice tone="warn" title={t.didNotProceedTitle} data-testid="telehealth-did-not-proceed">
            {t.didNotProceedBody}
          </Notice>
        )}
        {/* The reference to quote to the practice, at the foot of every state (D-2026-10-12-03 item 11). */}
        <p className={styles.reference} data-testid="telehealth-consultation-id">
          {t.consultationId(page.consultationId)}
        </p>
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
          <Button type="submit" variant="primary" disabled={busy || code.length !== DIGITS} data-testid="telehealth-continue">
            {busy ? t.checking : t.continue}
          </Button>
        </div>
      </form>
    </Shell>
  );
}
