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
  Mail,
  Phone,
  PenLine,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import { reviewFlags, type ReviewFlag } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, Section, SelectInput, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import { currentSession } from '../../auth';
import { flagLabel, flagWhy } from '../flags';
import { CheckRecorder, type RecordCheckInput } from '../CheckRecorder';
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
  history: Array<{ checkKey: string; outcome: string; performedByName: string; performedAt: string }>;
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
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
  const [entitlementMethod, setEntitlementMethod] = useState('');
  const [entitlementPhoneNumber, setEntitlementPhoneNumber] = useState('');
  const [entitlementNumberSource, setEntitlementNumberSource] = useState('');
  const [entitlementSpokeWithName, setEntitlementSpokeWithName] = useState('');
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
        <p className={ui.hint}>Loading…</p>
      </Shell>
    );
  }

  const flags = reviewFlags(row) as ReviewFlag[];
  const attested = row.abnVerificationSource === 'manual_attestation';

  // An approval needs an entitlement check; a rejection does not. Refusing an
  // application you could not verify is the CORRECT outcome, and requiring a
  // completed check before allowing that would have it exactly backwards.
  const entitlementComplete =
    entitlementMethod !== '' &&
    entitlementMethod !== 'none' &&
    (entitlementMethod !== 'phone_call' ||
      (entitlementPhoneNumber.trim() !== '' &&
        entitlementNumberSource !== '' &&
        entitlementSpokeWithName.trim() !== ''));

  const canApprove = reviewerName.trim().length > 0 && entitlementComplete && !busy;
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
                entitlementMethod,
                entitlementPhoneNumber: entitlementPhoneNumber.trim() || undefined,
                entitlementNumberSource: entitlementNumberSource || undefined,
                entitlementSpokeWithName: entitlementSpokeWithName.trim() || undefined,
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

      {/* Worst first, ahead of every tidy fact below. */}
      {flags.length > 0 && (
        <Section number={next()} title="Look at these first" aside={<ShieldAlert size={16} aria-hidden="true" />}>
          {flags.map((flag) => {
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
                    onCancel={() => setRecording(null)}
                    onSave={recordCheck}
                  />
                )}
              </li>
            );
          })}
        </ul>
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

        <Field label={strings.review.entitlementMethod} hint={strings.review.approveNeedsEntitlement}>
          {(props) => (
            <SelectInput
              {...props}
              value={entitlementMethod}
              onChange={(e) => setEntitlementMethod(e.target.value)}
              data-testid="review-entitlement-method"
            >
              <option value="">—</option>
              <option value="phone_call">Called the practice</option>
              <option value="domain_match">Email domain matches the practice website</option>
              <option value="hpio">HPI-O</option>
              <option value="document">Document sighted</option>
            </SelectInput>
          )}
        </Field>

        {/* A phone call is only evidence if the reviewer did not get the number
            from the applicant. These three fields are what make it evidence. */}
        {entitlementMethod === 'phone_call' && (
          <>
            <Field label={strings.review.entitlementNumber} required>
              {(props) => (
                <TextInput
                  {...props}
                  value={entitlementPhoneNumber}
                  onChange={(e) => setEntitlementPhoneNumber(e.target.value)}
                  data-testid="review-entitlement-number"
                />
              )}
            </Field>
            <Field
              label={strings.review.entitlementNumberSource}
              hint={strings.review.entitlementNumberSourceHint}
              required
            >
              {(props) => (
                <SelectInput
                  {...props}
                  value={entitlementNumberSource}
                  onChange={(e) => setEntitlementNumberSource(e.target.value)}
                  data-testid="review-entitlement-source"
                >
                  <option value="">—</option>
                  <option value="nhsd">National Health Services Directory</option>
                  <option value="practice_website">The practice website</option>
                  <option value="public_directory">Another public directory</option>
                  <option value="application_form">The application form</option>
                  <option value="other">Other</option>
                </SelectInput>
              )}
            </Field>
            <Field label={strings.review.entitlementSpokeWith} required>
              {(props) => (
                <TextInput
                  {...props}
                  value={entitlementSpokeWithName}
                  onChange={(e) => setEntitlementSpokeWithName(e.target.value)}
                  data-testid="review-entitlement-spoke-with"
                />
              )}
            </Field>
          </>
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
          {!canApprove && <span className={ui.hint}>{strings.review.approveNeedsEntitlement}</span>}
        </div>
      </Section>
    </Shell>
  );
}
