'use client';

/**
 * The practice's own dossier — everything the reviewer sees, in view mode.
 *
 * WHY THE PRACTICE SHOULD SEE ITS OWN FILE. Every fact here is about them, and
 * most of it decides what they can do: whether capture is open, why their
 * identity score is what it is, which of their credentials have actually been
 * checked. Keeping that on the reviewer's side only would mean a practice
 * learning what we hold about them by asking us — which is a worse answer than
 * showing them.
 *
 * READ-ONLY EXCEPT THE CONTACTS, and the split is not arbitrary:
 *
 *   - THE ENTITY IS LOCKED. The ABN identifies the legal entity that was
 *     approved, every consent record captured here names it, and a different
 *     ABN is a different entity — a new application, not an edit.
 *   - THE EVIDENCE IS APPEND-ONLY. Checks, credentials and the audit trail are
 *     the record of what happened. A practice editing its own evidence is not
 *     evidence.
 *   - THE CONTACTS ARE THEIRS TO CORRECT, and the commonest reason anything
 *     here needs fixing is a mistyped address — which is also the state in
 *     which nobody can be told anything.
 *
 * SECTIONS COLLAPSE because this is long and most visits want one thing. The
 * two that lead are the two that change: what is blocking capture, and the
 * contacts.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { Button, Chip, Notice, Section, Shell, ui } from '../../ui';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import { AuditTrail } from '../../review/AuditTrail';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Practice {
  id: string;
  name: string;
  legalName: string | null;
  tradingNames: string[] | null;
  abn: string | null;
  acn: string | null;
  abnStatus: string | null;
  entityType: string | null;
  abnVerificationSource: string | null;
  /**
   * WHEN the register last answered about this ABN.
   *
   * Shown because an ABN check is a fact about a DAY, not a property of an
   * entity: a practice approved in March against an ACTIVE ABN can be trading
   * on a cancelled one by September, and a page that showed only the status
   * would be quoting the March answer for ever without saying so.
   */
  abnVerifiedAt: string | null;
  abnSightedByName: string | null;
  validationState: string;
  validatedByName: string | null;
  validatedAt: string | null;
  headOfficeAddress: string | null;
  adminEmailVerifiedAt: string | null;
  adminName: string | null;
  adminEmail: string | null;
  adminPhone: string | null;
  adminPosition: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
  identityScoreAtDecision: number | null;
  identityScoringVersion: string | null;
  identityWouldPassAtDecision: boolean | null;
}

interface Credential {
  id: string;
  credentialType: string;
  credentialValue: string;
  label: string | null;
  verified: boolean;
  verifiedByName: string | null;
  verificationMethod: string | null;
}

interface Location {
  id: string;
  code: string | null;
  address: string;
  state: string | null;
  active: boolean;
}

interface Checks {
  summary: { score: number; passed: number; failed: number; incomplete: number; performed: number };
  admission: { wouldPass: boolean; reasons: string[] };
  history: Array<{
    id: string;
    checkKey: string;
    category: string;
    outcome: string;
    performedByName: string;
    performedAt: string;
    note: string | null;
  }>;
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function EntityView({ practiceId }: { practiceId: string }) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by nothing today; the trail component wants one, and it will be
   *  bumped again when editing lands on the review dossier. */
  const [reloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [pRes, cRes, lRes, kRes] = await Promise.all([
        fetch(`${CORE_URL}/practices/${practiceId}`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/organisations/credentials`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/organisations/locations`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/organisations/checks`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!pRes.ok) throw new Error(await refusalMessage(pRes));
      setPractice(await pRes.json());
      // The rest are supporting detail; a failure in one should not blank the
      // page, because the entity itself is what most visits came for.
      setCredentials(cRes.ok ? await cRes.json() : []);
      setLocations(lRes.ok ? await lRes.json() : []);
      setChecks(kRes.ok ? await kRes.json() : null);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  // Registered with the top-bar refresh; see refresh.ts.
  useRefreshable(load);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) {
    return (
      <Shell right={<SessionControl audience={strings.entity.audience} />} title={strings.entity.title}>
        <Notice tone="stop" title={strings.entity.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  if (!practice) {
    return (
      <Shell right={<SessionControl audience={strings.entity.audience} />}>
        <p className={ui.hint}>{strings.entity.loading}</p>
      </Shell>
    );
  }

  const attested = practice.abnVerificationSource === 'manual_attestation';
  const activeLocations = locations.filter((l) => l.active).length;
  const verifiedCredentials = credentials.filter((c) => c.verified).length;
  let n = 0;
  const next = () => (n += 1);

  return (
    <Shell
      right={<SessionControl audience={strings.entity.audience} />}
      title={practice.name}
      lead={strings.entity.lead}
    >
      {/* ---------------------------------------------------------------- */}
      <Section number={next()} title={strings.entity.title}>
        <div className={`${styles.card} ${attested ? styles.cardNeedsWork : styles.cardOk}`}>
          <div className={styles.cardHead}>
            <Building2 size={18} aria-hidden="true" className={styles.cardIcon} />
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{practice.legalName ?? practice.name}</p>
              <p className={styles.cardSub}>
                {strings.entity.abn} {practice.abn ?? '—'}
                {practice.acn ? ` · ${strings.entity.acn} ${practice.acn}` : ''}
                {practice.entityType ? ` · ${practice.entityType}` : ''}
              </p>
              {practice.tradingNames && practice.tradingNames.length > 0 && (
                <p className={styles.cardNote}>
                  {strings.entity.tradingAs} {practice.tradingNames.join(', ')}
                </p>
              )}
              {practice.headOfficeAddress && (
                <p className={styles.cardNote}>
                  {strings.entity.headOffice}: {practice.headOfficeAddress}
                </p>
              )}
              <p className={styles.cardNote}>
                {practice.validationState === 'validated'
                  ? `${strings.entity.approvedBy} ${practice.validatedByName ?? '—'} ${strings.entity.approvedOn} ${when(practice.validatedAt)}`
                  : strings.entity.notApproved}
              </p>
            </div>
            <div className={styles.cardAside}>
              {practice.abnStatus && (
                <Chip tone={practice.abnStatus === 'ACTIVE' ? 'ok' : 'stop'}>{practice.abnStatus}</Chip>
              )}
              {practice.identityScoreAtDecision !== null && (
                <Chip tone={practice.identityWouldPassAtDecision ? 'ok' : 'warn'}>
                  {strings.entity.scoreAtDecision.replace('{n}', String(practice.identityScoreAtDecision))}
                </Chip>
              )}
            </div>
          </div>
        </div>

        <Notice tone={attested ? 'warn' : 'ok'} title={strings.entity.verifiedHow}>
          <p>
            {attested
              ? strings.entity.verifiedAttested.replace('{who}', practice.abnSightedByName ?? 'The applicant')
              : strings.entity.verifiedAbr}
          </p>
          {/*
            THE PROVENANCE AND THE DATE, TOGETHER, because either alone is
            misleading: "the register said so" without a date is a claim with no
            shelf life, and a date without the source does not say whether the
            register or a colleague was the one who said it.
          */}
          <p className={ui.hint} data-testid="entity-abn-provenance">
            {strings.entity.verifiedSource}: {practice.abnVerificationSource ?? strings.entity.verifiedSourceUnknown}
            {' · '}
            {practice.abnVerifiedAt
              ? strings.entity.verifiedOn.replace('{date}', when(practice.abnVerifiedAt))
              : strings.entity.verifiedNever}
          </p>
          <AbnRecheck practice={practice} onDone={() => void load()} />
        </Notice>

        <Notice tone="ok" title={strings.entity.lockedTitle}>
          {strings.entity.lockedBody}
        </Notice>
      </Section>

      {/* --- Contacts: the one editable thing, and why ------------------- */}
      <Section number={next()} title={strings.entity.contactsTitle}>
        <p className={ui.hint}>{strings.entity.contactsLead}</p>
        <ContactsPanel practice={practice} />
      </Section>

      {/* --- What has been checked -------------------------------------- */}
      <Section
        number={next()}
        title={strings.entity.checksTitle}
        collapsible
        defaultOpen={false}
        summary={
          checks
            ? strings.entity.checksSummary
                .replace('{score}', String(checks.summary.score))
                .replace('{passed}', String(checks.summary.passed))
                .replace('{performed}', String(checks.summary.performed))
            : strings.entity.loading
        }
      >
        <p className={ui.hint}>{strings.entity.checksLead}</p>
        {checks && checks.history.length === 0 && <p className={ui.hint}>{strings.entity.checksNone}</p>}
        <ul className={styles.list}>
          {(checks?.history ?? []).map((h) => (
            <li key={h.id} className={`${styles.card} ${h.outcome === 'passed' ? styles.cardOk : styles.cardNeedsWork}`}>
              <div className={styles.cardHead}>
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{h.checkKey}</p>
                  <p className={styles.cardSub}>
                    {h.performedByName} · {when(h.performedAt)}
                  </p>
                  {h.note && <p className={styles.cardNote}>{h.note}</p>}
                </div>
                <div className={styles.cardAside}>
                  <Chip tone={h.outcome === 'passed' ? 'ok' : h.outcome === 'failed' ? 'stop' : 'warn'}>
                    {h.outcome}
                  </Chip>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Credentials -------------------------------------------------- */}
      <Section
        number={next()}
        title={strings.entity.credentialsTitle}
        collapsible
        defaultOpen={false}
        summary={strings.entity.credentialsSummary
          .replace('{verified}', String(verifiedCredentials))
          .replace('{total}', String(credentials.length))}
      >
        {/*
          The rule the whole score rests on, said where the credentials are:
          entering one is worth nothing, and only a recorded check gives it
          weight (IDENTITY-STRENGTH-DESIGN §1).
        */}
        <p className={ui.hint}>{strings.entity.credentialsLead}</p>
        {credentials.length === 0 && <p className={ui.hint}>{strings.entity.credentialsNone}</p>}
        <ul className={styles.list}>
          {credentials.map((c) => (
            <li key={c.id} className={`${styles.card} ${c.verified ? styles.cardOk : styles.cardNeedsWork}`}>
              <div className={styles.cardHead}>
                <ShieldCheck size={18} aria-hidden="true" className={styles.cardIcon} />
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>
                    {c.label ?? c.credentialType} — {c.credentialValue}
                  </p>
                  <p className={styles.cardNote}>
                    {c.verified
                      ? strings.entity.credentialVerifiedBy
                          .replace('{who}', c.verifiedByName ?? '—')
                          .replace('{how}', c.verificationMethod ?? '—')
                      : strings.entity.credentialUnverified}
                  </p>
                </div>
                <div className={styles.cardAside}>
                  <Chip tone={c.verified ? 'ok' : 'warn'}>
                    {c.verified ? strings.entity.verified : strings.entity.unverified}
                  </Chip>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Locations ---------------------------------------------------- */}
      <Section
        number={next()}
        title={strings.entity.locationsTitle}
        collapsible
        defaultOpen={false}
        summary={strings.entity.locationsSummary
          .replace('{active}', String(activeLocations))
          .replace('{total}', String(locations.length))}
      >
        <ul className={styles.list}>
          {locations.map((l) => (
            <li key={l.id} className={`${styles.card} ${l.active ? styles.cardOk : styles.cardNeedsWork}`}>
              <div className={styles.cardHead}>
                <MapPin size={18} aria-hidden="true" className={styles.cardIcon} />
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{l.code || l.address}</p>
                  {l.code && <p className={styles.cardSub}>{l.address}</p>}
                </div>
                <div className={styles.cardAside}>
                  <Chip tone={l.active ? 'ok' : 'warn'}>
                    {l.active ? strings.entity.confirmed : strings.entity.unconfirmed}
                  </Chip>
                  {l.state && <Chip tone="neutral">{l.state}</Chip>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Link href="/practice/locations" className={ui.buttonLink}>
          {strings.entity.manageLocations}
        </Link>
      </Section>

      {/* --- Everything that has happened --------------------------------- */}
      <Section
        number={next()}
        title={strings.entity.auditTitle}
        collapsible
        defaultOpen={false}
        summary={strings.entity.auditSummary}
      >
        <AuditTrail
          practiceId={practiceId}
          reloadKey={reloadKey}
        />
      </Section>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Ask the register again
// ---------------------------------------------------------------------------

interface RecheckResult {
  rechecked: boolean;
  outcome: string;
  reason?: string;
  abnStatus?: string | null;
  active?: boolean;
  statusChanged?: boolean;
  entityTypeChanged?: boolean;
  registerEntityType?: string;
  provenanceUpgraded?: boolean;
}

/**
 * "Re-check with the Australian Business Register".
 *
 * WHY AN ADMINISTRATOR SHOULD BE ABLE TO PRESS THIS. The stored answer has a
 * date on it and the register does not tell us when it changes. Two things
 * follow: a practice whose ABN was cancelled has no way to find out here, and
 * a practice whose application fell back to a typed attestation during an ABR
 * outage is stuck with the weaker evidence for ever. This fixes both, and it
 * is the practice's own act about their own entity.
 *
 * WHAT IT CANNOT DO IS CHANGE THE ABN. A different ABN is a different legal
 * entity — a new application, not an edit — which is the rule this whole page
 * is built on.
 *
 * A FAILED RE-CHECK CHANGES NOTHING. The server does not overwrite a good
 * stored answer because the register was briefly unreachable, and the message
 * here says which of the two happened.
 */
function AbnRecheck({ practice, onDone }: { practice: Practice; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecheckResult | null>(null);

  async function recheck() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${CORE_URL}/organisations/abn-recheck`, {
        method: 'POST',
        headers: apiHeaders(practice.id),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const body = (await res.json()) as RecheckResult;
      setResult(body);
      if (body.rechecked) onDone();
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = strings.entity;

  return (
    <div style={{ marginTop: 12 }}>
      <Button onClick={() => void recheck()} disabled={busy || !practice.abn} data-testid="entity-abn-recheck">
        {busy ? s.recheckBusy : s.recheckButton}
      </Button>
      <p className={ui.hint}>{s.recheckLead}</p>

      {error && <p className={ui.hint}>{error}</p>}

      {result && !result.rechecked && (
        <p className={ui.hint} data-testid="entity-abn-recheck-failed">
          {s.recheckFailed}{' '}
          {s.recheckReasons[result.reason ?? ''] ?? s.recheckUnknownReason.replace('{code}', result.reason ?? '—')}
        </p>
      )}

      {result?.rechecked && (
        <p className={ui.hint} data-testid="entity-abn-recheck-done">
          {result.statusChanged
            ? s.recheckStatusChanged.replace('{status}', result.abnStatus ?? '—')
            : s.recheckUnchanged.replace('{status}', result.abnStatus ?? '—')}
          {result.provenanceUpgraded ? ` ${s.recheckUpgraded}` : ''}
          {result.entityTypeChanged
            ? ` ${s.recheckEntityTypeChanged.replace('{type}', result.registerEntityType ?? '—')}`
            : ''}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts — the one thing on this page that can change
// ---------------------------------------------------------------------------

/**
 * WHY THIS ONE IS EDITABLE when nothing else on the page is.
 *
 * A contact detail is not evidence. It is how we reach the practice, and the
 * commonest thing wrong with an approved practice is a mistyped email — which
 * is also the state in which nobody can be told anything, so it has to be
 * fixable from inside.
 *
 * IT STILL COSTS A NAME AND A REASON. This is the record of who was approved,
 * and a change to it with no stated reason is indistinguishable from a mistake.
 * The server refuses without both.
 *
 * CHANGING THE ADMIN EMAIL UNVERIFIES IT, and the form says so BEFORE the
 * change rather than after: the old address had been confirmed, the new one has
 * not, and carrying the tick across would assert a round trip that never
 * happened.
 */
function ContactsPanel({ practice }: { practice: Practice }) {
  /*
   * THE NAME COMES FROM THE SESSION, not from a box.
   *
   * Asking somebody to type their own name is asking them to assert an
   * identity we already hold, and the answer is worth exactly as much as
   * whatever they type. Same rule as the reviewer screens.
   *
   * The typed fallback exists only because PRACTICE sign-in does not, and it
   * is shown against a notice saying plainly that it identifies nobody. The
   * moment a practice admin has a session this becomes dead code.
   */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const headers = apiHeaders(practice.id);

  async function resend() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`${CORE_URL}/organisations/${practice.id}/resend-invitation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          // From the session where there is one. Asking somebody to type their
          // own name is asking them to assert an identity we already hold.
          requestedByName: currentSession()?.username ?? practice.adminName ?? 'Practice admin',
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const body = (await res.json()) as { invited: boolean; detail: string };
      if (!body.invited) throw new Error(body.detail);
      setDone(body.detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardMain}>
            <p className={styles.cardSub}>{strings.entity.adminContact}</p>
            <p className={styles.cardTitle}>{practice.adminName ?? '—'}</p>
            <p className={styles.cardNote}>
              {practice.adminEmail ?? '—'} · {practice.adminPhone ?? '—'}
              {practice.adminPosition ? ` · ${practice.adminPosition}` : ''}
            </p>
          </div>
          <div className={styles.cardAside}>
            <Chip tone={practice.adminEmailVerifiedAt ? 'ok' : 'warn'}>
              {practice.adminEmailVerifiedAt ? (
                <>
                  <CheckCircle2 size={13} aria-hidden="true" />
                  {strings.entity.emailVerified}
                </>
              ) : (
                <>
                  <AlertTriangle size={13} aria-hidden="true" />
                  {strings.entity.emailUnverified}
                </>
              )}
            </Chip>
          </div>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.cardSub}>{strings.entity.managerContact}</p>
          <p className={styles.cardTitle}>{practice.managerName ?? '—'}</p>
          <p className={styles.cardNote}>
            {practice.managerEmail ?? '—'} · {practice.managerPhone ?? '—'}
          </p>
        </div>
        <div className={styles.cardActions}>
            <Button onClick={() => void resend()} disabled={busy} data-testid="entity-resend">
              {busy ? strings.entity.resending : strings.entity.resendInvitation}
            </Button>
        </div>
      </div>

      {error && (
        <Notice tone="stop" title={strings.entity.saveFailed}>
          {error}
        </Notice>
      )}
      {done && !error && <Notice tone="ok">{done}</Notice>}
    </>
  );
}
