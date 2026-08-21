'use client';

/**
 * The reviewer's dossier — everything gate 3 needs, on one screen.
 *
 * Three principles, in the order they matter:
 *
 *   1. WORST FIRST. The flags sit at the top, before the tidy facts. Every
 *      application that reaches this screen has already passed two gates, so
 *      the whole file reads as reassuring; anything troubling has to interrupt
 *      that before the reviewer settles into skimming. The danger here is not a
 *      reviewer fooled by something obviously wrong — it is a reviewer
 *      approving the twenty-first tidy application out of rhythm.
 *
 *   2. PROVENANCE, NOT JUST VALUE. "ABN status: ACTIVE" is a different fact
 *      depending on whether the ABR said so or the applicant typed it. Any
 *      value that can arrive from more than one source states which source,
 *      immediately beside the value — not in a footnote, because a footnote is
 *      what gets skipped.
 *
 *   3. THE DECISION IS OWNED. The reviewer's name is required, and an approval
 *      additionally requires an entitlement check. "The ABN is valid" never
 *      answered the question of whether THIS PERSON may act for it, and that
 *      unanswered question is the whole reason gate 3 exists.
 *
 * The identity score is shown and never enforced — soft by design, per
 * IDENTITY-STRENGTH-DESIGN.md, so the threshold can eventually be set against
 * real decisions rather than a guess.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Gauge,
  History,
  Link2,
  Mail,
  MailWarning,
  Phone,
  PenLine,
  Ban,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import {
  CHECK_CATALOGUE,
  blockingFlags,
  establishingEntitlementCheck,
  reviewFlags,
  type PerformedCheck,
  type ReviewFlag,
} from '@aobplatform/domain';
import { Button, Chip, Field, Notice, Section, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import { currentSession } from '../../auth';
import { flagLabel, flagWhy } from '../flags';
import { CheckRecorder, type RecordCheckInput } from '../CheckRecorder';
import { AuditTrail } from '../AuditTrail';
import { formatAbn, type QueueRow } from '../QueueView';
import styles from '../review.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Mirrors packages/domain/src/checks.ts. Shown, never enforced here. */
const MINIMUM_SCORE = 6;

interface CatalogueCheck {
  key: string;
  category: string;
  label: string;
  weight: string;
  whatItProves: string;
  evidenceGuidance?: string;
  evidenceRequired?: boolean;
  requiredFields?: string[];
  verifyAt?: { label: string; url: string };
}

interface CataloguePayload {
  checklistVersion: string;
  checks: CatalogueCheck[];
  failureReasons: string[];
  incompleteReasons: string[];
}

interface ChecksPayload {
  checklistVersion: string;
  summary: { score: number; passed: number; strongPassed: number; entitlementPassed: number };
  admission: { wouldPass: boolean; reasons: string[] };
  history: Array<{
    checkKey: string;
    category: string;
    outcome: string;
    performedByName: string;
    performedAt: string;
    fields?: Record<string, unknown> | null;
    artefacts?: Array<{ id: string; filename: string }>;
  }>;
}

/**
 * Ask the applicant to correct something.
 *
 * A blocking flag has to come with a way through, or it teaches reviewers to
 * find a way around. This emails the applicant a link to fix their own details.
 *
 * Three things about that link, all deliberate:
 *
 *   - It needs NO sign-in. The practice admin has no account here until the
 *     practice is approved, so requiring one would deadlock: no passkey until
 *     approval, no approval until the correction is made.
 *   - It is the application's status TOKEN, never its id. A primary key that
 *     doubles as a credential is a credential that leaks — and this one is
 *     going into an email.
 *   - It expires in five days. A correction link with no expiry is a standing
 *     credential sitting in an inbox indefinitely.
 *
 * The reason is REQUIRED and is sent verbatim, which is why it is a field here
 * rather than a canned message: only the reviewer knows what is actually wrong.
 */
function RequestCorrection({ id, reviewerName }: { id: string; reviewerName: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${CORE_URL}/organisations/${id}/request-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), requestedByName: reviewerName.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That was refused (${response.status}).`);
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Notice tone="ok" title={strings.review.amendSent}>
        {strings.review.amendSentBody}
      </Notice>
    );
  }

  return (
    <div style={{ marginTop: 'var(--s4)' }}>
      <p className={ui.hint} style={{ marginBottom: 'var(--s3)' }}>
        {strings.review.amendLinkExplain}
      </p>
      <Field label={strings.review.amendReason} hint={strings.review.amendReasonHint} required>
        {(props) => (
          <TextInput
            {...props}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="review-amend-reason"
          />
        )}
      </Field>
      {error && (
        <Notice tone="stop" title={strings.review.amendFailed}>
          {error}
        </Notice>
      )}
      <div className={styles.decideActions}>
        <Button
          // Dead until there is both a reason to send and a name to send it
          // under. An unattributed request to change an application is not
          // something an applicant should ever receive.
          disabled={reason.trim().length < 10 || reviewerName.trim().length === 0 || busy}
          onClick={send}
          data-testid="review-amend-link"
        >
          <Link2 size={15} aria-hidden="true" />
          {busy ? strings.review.sendingAmendLink : strings.review.sendAmendLink}
        </Button>
      </div>
    </div>
  );
}

/**
 * Send the applicant a link to confirm their email address.
 *
 * New applications get one automatically at submission, so this covers the two
 * cases automation cannot: a link that expired or never arrived, and an
 * application that predates the feature. Sitting next to the flag it answers
 * means the reviewer does not have to go looking for the remedy.
 */
function SendVerification({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${CORE_URL}/organisations/${id}/request-email-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!response.ok) throw new Error(body.message ?? `That was refused (${response.status}).`);
      setSent(body.detail ?? strings.review.verificationSent);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className={ui.hint}>{sent}</p>;

  return (
    <>
      {error && (
        <Notice tone="stop" title={strings.review.verificationFailed}>
          {error}
        </Notice>
      )}
      <Button onClick={send} disabled={busy} data-testid="review-send-verification">
        <MailWarning size={15} aria-hidden="true" />
        {busy ? strings.review.sendingVerification : strings.review.sendVerification}
      </Button>
    </>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The catalogue's own words for a check, so the decision names it as the checklist does. */
function checkLabel(key: string): string {
  return CHECK_CATALOGUE.find((c) => c.key === key)?.label ?? key;
}

export function DossierView({ id }: { id: string }) {
  const [row, setRow] = useState<QueueRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [catalogue, setCatalogue] = useState<CatalogueCheck[]>([]);
  const [failureReasons, setFailureReasons] = useState<string[]>([]);
  const [incompleteReasons, setIncompleteReasons] = useState<string[]>([]);
  // Which check is being recorded. One at a time — a screen of twelve open
  // forms is a screen nobody fills in carefully.
  const [recording, setRecording] = useState<string | null>(null);
  // Bumped after anything is recorded, so the trail below re-reads rather than
  // sitting stale against the checklist immediately above it.
  const [trailVersion, setTrailVersion] = useState(0);
  const [checks, setChecks] = useState<ChecksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<'validated' | 'rejected' | null>(null);

  /**
   * The reviewer.
   *
   * Taken from the session when there is one. There is NOT one today: the
   * Keycloak `web` client is the clinician-browser flow for practice admins
   * and practitioners, and no platform-admin sign-in exists yet. So this falls
   * back to a typed name — asked ONCE, at the top, next to a notice saying
   * plainly that it identifies nobody.
   *
   * That fallback is the honest shape of the gap, not a solution to it. The
   * moment platform-admin sign-in exists, the useState below becomes dead code
   * and the session value is the only source. Until then, every check and
   * every approval in this system carries an unverified name, and the screen
   * says so rather than implying otherwise.
   */
  const signedInAs = currentSession()?.username ?? null;
  const [typedName, setTypedName] = useState('');
  const reviewerName = signedInAs ?? typedName;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadChecks = useCallback(() => {
    fetch(`${CORE_URL}/organisations/checks`, { headers: { 'x-practice-id': id } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setChecks)
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    // The pending queue is the source. An application is only reviewable while
    // it is still waiting, so there is deliberately no second endpoint that
    // could disagree with the list the reviewer just came from.
    fetch(`${CORE_URL}/organisations/pending`)
      .then((r) => r.json())
      .then((data) => {
        const found = (data.organisations ?? []).find((o: QueueRow) => o.id === id);
        if (found) setRow(found);
        else setMissing(true);
      })
      // A dead connection throws a TypeError whose message is "Failed to
      // fetch" — a DOM exception string, not an answer. Say what happened.
      .catch(() => setError(strings.review.unreachableBody));

    fetch(`${CORE_URL}/organisations/checks/catalogue`)
      .then((r) => r.json())
      .then((data: CataloguePayload) => {
        setCatalogue(data.checks ?? []);
        // The reason lists come from the catalogue, not from a constant here.
        // They are versioned with the checklist, and a hard-coded copy would
        // silently diverge the moment the catalogue version moves.
        setFailureReasons(data.failureReasons ?? []);
        setIncompleteReasons(data.incompleteReasons ?? []);
      })
      .catch(() => undefined);

    loadChecks();
  }, [id, loadChecks]);

  if (missing) {
    return (
      <Shell right={strings.review.audience}>
        <Link href="/review" className={styles.backLink}>
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.review.back}
        </Link>
        <h1 className={ui.pageTitle}>{strings.review.notFound}</h1>
        <p className={ui.pageLead}>{strings.review.notFoundBody}</p>
      </Shell>
    );
  }

  if (!row) {
    return (
      <Shell right={strings.review.audience}>
        <Link href="/review" className={styles.backLink}>
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.review.back}
        </Link>
        {/*
          The error MUST be checked before falling back to "Loading…".
          Previously this branch returned unconditionally, so a failed fetch
          left the page saying "Loading…" for ever — the one state that tells
          the reader to keep waiting, in the one situation where waiting will
          never help.
        */}
        {error ? (
          <Notice
            tone="stop"
            title={error === strings.review.unreachableBody ? strings.review.unreachable : strings.review.loadFailed}
          >
            {error}
          </Notice>
        ) : (
          <p className={ui.hint}>{strings.review.loading}</p>
        )}
      </Shell>
    );
  }

  // The score is passed in so the thin-proof note can retire once the recorded
  // checks would clear the threshold — otherwise it sits there contradicting a
  // passing score two sections below it.
  const flags = reviewFlags({
    ...row,
    wouldPassIdentity: checks?.admission.wouldPass,
    // So a flag whose remedy has been performed retires rather than standing
    // next to the check that satisfied it.
    passedCheckKeys: (checks?.history ?? []).filter((h) => h.outcome === 'passed').map((h) => h.checkKey),
  }) as ReviewFlag[];
  const blocked = blockingFlags(flags);
  const attested = row.abnVerificationSource === 'manual_attestation';

  /*
   * IF ENTITLEMENT HAS ALREADY BEEN ESTABLISHED, THE DECISION USES IT.
   *
   * The reviewer records the check in section 4 — the number, where the number
   * came from, who answered, and the evidence — and was then asked to type the
   * same facts again down here. Beyond the obvious duplication, that produced
   * two records of one event that could disagree, and the retyped one was the
   * copy with no artefact attached.
   *
   * It also misattributed the check. One person rings the practice and another
   * approves; retyping John's call into Carl's decision made the record say
   * Carl made the call.
   *
   * Same rule as the server uses, from the domain, so the button and the API
   * cannot disagree about whether this application can be approved.
   */
  const established = establishingEntitlementCheck((checks?.history ?? []) as PerformedCheck[]);

  /*
   * THE GATE IS THE IDENTITY ASSESSMENT, not a second form.
   *
   * assessAdmission() already requires all three of: a score at or above the
   * threshold, at least one STRONG check passed, and at least one ENTITLEMENT
   * check passed. So the old separate "entitlementMethod is filled in" test was
   * a weaker restatement of a condition the assessment already covers — and it
   * refused applications the assessment was perfectly happy with, which is what
   * XLEVELUP hit at score 9.
   *
   * A rejection is NOT gated on any of this. Refusing an application you could
   * not verify is the correct outcome, and requiring a completed check before
   * allowing a refusal would have it exactly backwards.
   *
   * NOTE WHAT THIS MEANS. The button now reflects the threshold, so a practice
   * below it cannot be approved from this screen. The SERVER still runs in
   * whatever IDENTITY_ENFORCEMENT says — soft by default — so the two can
   * differ, and when they do it is the screen that is stricter. Making the
   * server refuse as well, with the written-override path, is
   * IDENTITY_ENFORCEMENT=hard, in one place.
   */
  const identitySufficient = checks?.admission.wouldPass === true;

  // A blocking flag REFUSES the approval, it does not merely warn about it.
  // The distinction matters: a warning that can be clicked past is a warning
  // that will be, on the twenty-first tidy application of the afternoon.
  //
  // Rejection stays available. A blocked application is one that cannot be
  // approved as it stands — not one that must be refused, and certainly not one
  // the reviewer should be unable to act on at all.
  const canApprove = reviewerName.trim().length > 0 && identitySufficient && blocked.length === 0 && !busy;
  const canReject = reviewerName.trim().length > 0 && note.trim().length > 0 && !busy;

  /**
   * Append one check.
   *
   * Append-only: this never edits. A correction is a new entry, which is why
   * the history below shows every attempt and not just the latest — the record
   * of a reviewer changing their mind IS evidence, and overwriting it would
   * destroy the thing the checklist exists to produce.
   */
  async function recordCheck(input: RecordCheckInput) {
    setError(null);
    try {
      const response = await fetch(`${CORE_URL}/organisations/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-practice-id': id },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That check was refused (${response.status}).`);
      }
      setRecording(null);
      // Re-read rather than patching local state: recording a check moves the
      // SCORE and the admission reasons, and computing those here would be a
      // second implementation of the scoring rules.
      loadChecks();
      setTrailVersion((v) => v + 1);
    } catch (e) {
      // RETHROWN, so the recorder shows it beside the button that was pressed.
      // Setting the page-level error here put the message two thousand pixels
      // above the form, where a reviewer reasonably concluded nothing had
      // happened at all.
      throw new Error(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message, {
        cause: e,
      });
    }
  }

  async function decide(decision: 'validated' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${CORE_URL}/organisations/${id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reviewerName,
          note: note.trim() || undefined,
          ...(decision === 'validated'
            ? {
                /*
                 * NOTHING ABOUT ENTITLEMENT IS SENT FROM HERE ANY MORE. The
                 * server reads it off the recorded check, which carries the
                 * evidence and the person who performed it. Sending a second
                 * copy would only give it something to disagree with.
                 *
                 * The API still accepts these fields for a caller with no
                 * recorded check; this screen is simply never that caller.
                 */
              }
            : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `The decision was refused (${response.status}).`);
      }
      setDecided(decision);
    } catch (e) {
      // A TypeError here means the request never reached the service at all,
      // so nothing was decided. That is a different thing from a refusal and
      // must not read like one.
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (decided) {
    return (
      <Shell right={strings.review.audience}>
        <h1 className={ui.pageTitle}>
          {decided === 'validated' ? strings.review.decidedApproved : strings.review.decidedRejected}: {row.name}
        </h1>
        <p className={ui.pageLead}>{strings.review.decidedBody}</p>
        <Link href="/review" className={styles.backLink}>
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.review.back}
        </Link>
      </Shell>
    );
  }

  // Numbered from whatever is actually present, so the reviewer never sees a
  // gap where a section was suppressed.
  let n = 0;
  const next = () => (n += 1);

  return (
    <Shell right={strings.review.audience}>
      <Link href="/review" className={styles.backLink}>
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.review.back}
      </Link>
      <h1 className={ui.pageTitle}>{row.name}</h1>
      <p className={ui.pageLead}>
        ABN {formatAbn(row.abn)}
      </p>

      {error && (
        <Notice tone="stop" title={error === strings.review.unreachableBody ? strings.review.unreachable : 'That did not go through'}>
          {error}
        </Notice>
      )}

      {/*
        Identity first — before the flags, because everything below is recorded
        against it and a reviewer should know whose name is going on the record
        before they start putting things there.
      */}
      {signedInAs ? (
        <p className={ui.hint} style={{ marginBottom: 'var(--s5)' }}>
          {strings.review.identityAs} <strong>{signedInAs}</strong>
        </p>
      ) : (
        <div className={styles.identity} data-testid="review-identity">
          <div className={styles.identityHead}>
            <UserX size={16} aria-hidden="true" />
            {strings.review.identityUnverified}
          </div>
          <p className={styles.identityBody}>{strings.review.identityUnverifiedBody}</p>
          <div className={styles.identityField}>
            <Field label={strings.review.identityName} required>
              {(props) => (
                <TextInput
                  {...props}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  data-testid="review-reviewer-name"
                />
              )}
            </Field>
          </div>
        </div>
      )}

      {/*
        Blocking first, in its own section, because it answers a different
        question from the rest. The flags below say "weigh this"; these say the
        decision cannot be made — and each carries the remedy, since a barrier
        with no way through just teaches people to go around it.
      */}
      {blocked.length > 0 && (
        <Section number={next()} title={strings.review.blockingHeading} aside={<Ban size={16} aria-hidden="true" />}>
          <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }}>
            {strings.review.blockingLead}
          </p>
          {blocked.map((flag) => (
            <div className={`${styles.flagDetail} ${styles.flagDetailBlocking}`} key={flag.key}>
              <div>
                <div className={styles.flagDetailWhat}>{flagLabel(flag)}</div>
                {flagWhy(flag) && <p className={styles.flagDetailWhy}>{flagWhy(flag)}</p>}
              </div>
            </div>
          ))}
          <RequestCorrection id={id} reviewerName={reviewerName} />
        </Section>
      )}

      {/* Worst first, ahead of every tidy fact below. */}
      {flags.filter((f) => f.severity !== 'blocking').length > 0 && (
        <Section number={next()} title="Look at these first" aside={<ShieldAlert size={16} aria-hidden="true" />}>
          {flags
            .filter((f) => f.severity !== 'blocking')
            .map((flag) => {
            const why = flagWhy(flag);
            const toneClass =
              flag.severity === 'high'
                ? styles.flagDetailHigh
                : flag.severity === 'medium'
                  ? styles.flagDetailMedium
                  : styles.flagDetailLow;
            return (
              <div className={`${styles.flagDetail} ${toneClass}`} key={flag.key}>
                <div>
                  <div className={styles.flagDetailWhat}>{flagLabel(flag)}</div>
                  {why && <p className={styles.flagDetailWhy}>{why}</p>}
                  {/* The remedy beside the problem, so it is not somewhere else. */}
                  {flag.key === 'email_unverified' && (
                    <div style={{ marginTop: 'var(--s3)' }}>
                      <SendVerification id={id} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Section>
      )}

      <Section
        number={next()}
        title={strings.review.entityHeading}
        aside={
          // Provenance as a chip, at the head of the section it qualifies —
          // because it qualifies EVERY value in it, not one of them.
          <Chip tone={attested ? 'warn' : 'ok'}>
            {attested ? <ShieldAlert size={13} aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}
            {attested ? strings.review.viaAttestation : strings.review.viaApi}
          </Chip>
        }
      >
        <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }} data-testid="review-as-submitted">
          <strong>{strings.review.asSubmitted}</strong> {strings.review.asSubmittedWhy}
        </p>
        <dl className={styles.facts}>
          <Fact term={strings.review.appliedAs}>
            <span className={styles.factStrong}>{row.name}</span>
          </Fact>
          <Fact term={strings.review.legalName}>{row.legalName ?? strings.review.noneRecorded}</Fact>
          {row.tradingNames && row.tradingNames.length > 0 && (
            <Fact term={strings.review.tradingNames}>{row.tradingNames.join(', ')}</Fact>
          )}
          <Fact term={strings.review.entityType}>{row.entityType ?? strings.review.noneRecorded}</Fact>
          <Fact term={strings.review.abnStatus}>
            {row.abnStatus ?? strings.review.noneRecorded}
            {attested && (
              <span className={ui.hint}>
                {' '}
                — {strings.review.sightedBy.toLowerCase()} {row.abnSightedByName ?? 'the applicant'}
              </span>
            )}
          </Fact>
          <Fact term={strings.review.nameMatch}>
            {row.nameMatchTier ?? strings.review.noneRecorded}
            {row.nameMatchedOn && <span className={ui.hint}> — on “{row.nameMatchedOn}”</span>}
          </Fact>
          <Fact term={strings.review.headOffice}>{row.headOfficeAddress ?? strings.review.noneRecorded}</Fact>
          <Fact term={strings.review.websiteLabel}>{row.website ?? strings.review.noneRecorded}</Fact>
          <Fact term={strings.review.proofsHeading}>
            {row.credentialValue ? (
              <>
                {row.credentialType} {row.credentialValue}
              </>
            ) : (
              strings.review.proofNone
            )}
          </Fact>
        </dl>
      </Section>

      <Section number={next()} title={strings.review.contactsHeading} aside={<Users size={16} aria-hidden="true" />}>
        <div className={styles.contactPair}>
          <div className={styles.contactCard}>
            <p className={styles.contactRole}>{strings.review.contactAdmin}</p>
            <div className={styles.contactName}>{row.adminName}</div>
            {row.adminPosition && <div className={ui.hint}>{row.adminPosition}</div>}
            <div className={styles.contactLine}>
              <Mail size={14} aria-hidden="true" />
              {row.adminEmail}
            </div>
            <div className={styles.contactLine}>
              <Phone size={14} aria-hidden="true" />
              {row.adminPhone}
            </div>
          </div>
          <div className={styles.contactCard}>
            <p className={styles.contactRole}>{strings.review.contactManager}</p>
            {row.managerName ? (
              <>
                <div className={styles.contactName}>{row.managerName}</div>
                {row.managerPosition && <div className={ui.hint}>{row.managerPosition}</div>}
                <div className={styles.contactLine}>
                  <Mail size={14} aria-hidden="true" />
                  {row.managerEmail}
                </div>
                <div className={styles.contactLine}>
                  <Phone size={14} aria-hidden="true" />
                  {row.managerPhone}
                </div>
              </>
            ) : (
              <p className={ui.hint}>{strings.review.contactNone}</p>
            )}
          </div>
        </div>
      </Section>

      {checks && (
        <Section number={next()} title={strings.review.scoreHeading} aside={<Gauge size={16} aria-hidden="true" />}>
          <div className={styles.score}>
            <span className={styles.scoreValue} data-testid="review-score">
              {checks.summary.score}
            </span>
            <span className={styles.scoreOf}>
              {strings.review.scoreOf} {MINIMUM_SCORE} {strings.review.scorePoints}
            </span>
            <Chip tone={checks.admission.wouldPass ? 'ok' : 'warn'}>
              {checks.admission.wouldPass ? strings.review.scoreWouldPass : strings.review.scoreWouldNotPass}
            </Chip>
          </div>
          {checks.admission.reasons.length > 0 && (
            <ul className={styles.scoreReasons}>
              {checks.admission.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <p className={ui.hint} style={{ marginTop: 'var(--s3)' }}>
            {strings.review.scoreSoft}
          </p>
        </Section>
      )}

      <Section
        number={next()}
        title={strings.review.checksHeading}
        aside={<ClipboardList size={16} aria-hidden="true" />}
      >
        <p className={ui.hint} style={{ marginBottom: 'var(--s3)' }}>
          {strings.review.checksLead} {strings.review.checkAppendOnly}
        </p>
        <ul className={styles.checkList}>
          {catalogue.map((check) => {
            const done = checks?.history.filter((h) => h.checkKey === check.key) ?? [];
            const latest = done[done.length - 1];
            const open = recording === check.key;
            return (
              <li className={styles.checkItem} key={check.key}>
                <div className={styles.checkHead}>
                  <div className={styles.checkLabel}>
                    {check.label}
                    <p className={styles.checkProves}>{check.whatItProves}</p>
                    {check.evidenceGuidance && open && (
                      <p className={styles.checkProves}>{check.evidenceGuidance}</p>
                    )}
                  </div>
                  <Chip tone={check.weight === 'STRONG' ? 'ok' : 'neutral'}>{check.weight}</Chip>
                  {latest ? (
                    <Chip tone={latest.outcome === 'passed' ? 'ok' : latest.outcome === 'failed' ? 'stop' : 'warn'}>
                      <FileCheck2 size={13} aria-hidden="true" />
                      {strings.review.checkOutcomes[latest.outcome as keyof typeof strings.review.checkOutcomes] ??
                        latest.outcome}
                    </Chip>
                  ) : (
                    <Chip tone="neutral">{strings.gates.marks.not_run}</Chip>
                  )}
                  {!open && (
                    <Button
                      variant="subtle"
                      // Dead until the reviewer is named. A check that names
                      // nobody is not a check, so the form does not open.
                      disabled={reviewerName.trim().length === 0}
                      title={reviewerName.trim().length === 0 ? strings.review.identityNeeded : undefined}
                      onClick={() => setRecording(check.key)}
                      data-testid={`check-open-${check.key}`}
                    >
                      <PenLine size={14} aria-hidden="true" />
                      {latest ? strings.review.checkRecordThis : strings.review.checkRun}
                    </Button>
                  )}
                </div>

                {/* Every attempt, oldest first — a correction is a new entry, so
                    the trail of them is part of the evidence. */}
                {done.length > 0 && (
                  <ul className={styles.checkHistory}>
                    {done.map((entry, i) => (
                      <li key={`${entry.checkKey}-${entry.performedAt}-${i}`}>
                        {strings.review.checkHistory}{' '}
                        {strings.review.checkOutcomes[entry.outcome as keyof typeof strings.review.checkOutcomes] ??
                          entry.outcome}{' '}
                        {strings.review.checkBySuffix} {entry.performedByName}
                      </li>
                    ))}
                  </ul>
                )}

                {open && (
                  <CheckRecorder
                    checkKey={check.key}
                    performedByName={reviewerName.trim()}
                    failureReasons={failureReasons}
                    incompleteReasons={incompleteReasons}
                    verifyAt={check.verifyAt}
                    evidenceRequired={check.evidenceRequired ?? false}
                    requiredFields={check.requiredFields ?? []}
                    practiceId={id}
                    abn={row.abn}
                    onCancel={() => setRecording(null)}
                    onSave={recordCheck}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {/*
        Collapsed by default. It is the longest thing on the page and the least
        often needed — a reviewer comes here to decide, and an open trail pushes
        the decision below the fold. The stand-in line keeps the fact that
        something happened visible even when folded.
      */}
      <Section
        number={next()}
        title={strings.review.auditHeading}
        aside={<History size={16} aria-hidden="true" />}
        collapsible
        defaultOpen={false}
        summary={strings.review.auditCollapsed}
      >
        <AuditTrail practiceId={id} reloadKey={trailVersion} readByName={reviewerName} />
      </Section>

      <Section number={next()} title={strings.review.decideHeading} aside={<Stamp size={16} aria-hidden="true" />}>
        <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }}>
          {strings.review.decideLead}
        </p>

        {/* The name is asked once, at the top. Asking again here would imply
            two separate attestations where there is one person. */}
        <p className={ui.hint} style={{ marginBottom: 'var(--s4)' }}>
          {strings.review.checkWillBeRecordedAs}{' '}
          <strong>{reviewerName.trim() || '—'}</strong>
        </p>

        {/*
          THE SCORE, RESTATED WHERE THE DECISION IS MADE.
          
          It was already on the page — in the checks section above — and on a
          dossier this long that means it is off-screen at the moment somebody
          reaches for Approve. The number they are deciding against should be
          in front of them when they decide, not several screens up.
          
          It INFORMS and does not gate. Enforcement is soft by design
          (IDENTITY-STRENGTH-DESIGN §2): the score refuses nobody yet, because
          a threshold you are already enforcing is one you can never calibrate —
          you never see the outcomes of the applications you turned away. What
          turns it into a refusal is IDENTITY_ENFORCEMENT=hard, deliberately,
          in one place, and then the SERVER refuses rather than a button.
        */}
        {checks && (
          <p className={styles.decideScore}>
            <Chip tone={checks.admission.wouldPass ? 'ok' : 'warn'}>
              {strings.review.decideScore.replace('{n}', String(checks.summary.score))}
            </Chip>{' '}
            <span className={ui.hint}>
              {checks.admission.wouldPass
                ? strings.review.decideScorePasses
                : strings.review.decideScoreBelow.replace('{why}', checks.admission.reasons.join(' '))}
            </span>
          </p>
        )}

        {/*
          WHAT THE APPROVAL WILL REST ON, when a check has already established
          it. Shown instead of an empty form, and it names the person who
          actually performed it — which is frequently not the person approving.
        */}
        {established && (
          <Notice tone="ok" title={strings.review.entitlementEstablished}>
            {strings.review.entitlementEstablishedBy
              .replace('{label}', checkLabel(established.check.checkKey))
              .replace('{who}', established.performedByName)
              .replace('{when}', new Date(established.performedAt).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }))}
            {established.spokeWithName ? ` ${strings.review.entitlementEstablishedSpokeWith.replace('{who}', established.spokeWithName)}` : ''}
            {established.hasEvidence ? ` ${strings.review.entitlementHasEvidence}` : ` ${strings.review.entitlementNoEvidence}`}
            {established.alsoPassed.length > 0
              ? ` ${strings.review.entitlementAlsoPassed.replace('{n}', String(established.alsoPassed.length))}`
              : ''}
            <br />
            {strings.review.entitlementNotRetyped}
          </Notice>
        )}

        {/*
          NO INLINE ENTITLEMENT FORM ANY MORE.
          
          It used to sit here so a reviewer could state the entitlement at the
          moment of deciding. That made sense when it was what unlocked the
          button. It no longer is — the gate is the identity assessment, which
          counts RECORDED checks — so a form here could be filled in completely
          and change nothing, which is worse than not offering it.
          
          Entitlement belongs in the checklist above, where a check carries an
          author, an outcome, and its evidence. This says so rather than
          leaving somebody to wonder where the field went.
        */}
        {!established && (
          <Notice tone="warn" title={strings.review.entitlementNoneYet}>
            {strings.review.entitlementRecordItAbove}
          </Notice>
        )}

        <Field label={strings.review.rejectReason} hint={strings.review.rejectDisclosure}>
          {(props) => (
            <TextInput {...props} value={note} onChange={(e) => setNote(e.target.value)} data-testid="review-note" />
          )}
        </Field>

        <div className={styles.decideActions}>
          <Button
            variant="primary"
            disabled={!canApprove}
            onClick={() => decide('validated')}
            data-testid="review-approve"
          >
            <CheckCircle2 size={15} aria-hidden="true" />
            {strings.review.approve}
          </Button>
          <Button
            className={styles.buttonStop}
            disabled={!canReject}
            onClick={() => decide('rejected')}
            data-testid="review-reject"
          >
            <XCircle size={15} aria-hidden="true" />
            {strings.review.reject}
          </Button>
          {!canApprove && (
            <span className={ui.hint}>
              {blocked.length > 0 ? strings.review.blockedApprove : strings.review.approveNeedsEntitlement}
            </span>
          )}
        </div>
      </Section>
    </Shell>
  );
}
