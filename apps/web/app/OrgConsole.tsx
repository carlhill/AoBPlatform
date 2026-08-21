'use client';

/**
 * The organisation / location / practitioner / affiliation console
 * (ORG-MODEL-PROPOSAL.md).
 *
 * This screen is deliberately shaped like the RULES rather than like a CRUD
 * form. The things worth seeing on screen are the refusals:
 *
 *   - a name that matched only after ignoring "Pty Ltd" is flagged, not
 *     silently accepted
 *   - a location is INACTIVE until a human confirms the address, and says why
 *   - an affiliation shows `blockReason` verbatim, so "capture is closed"
 *     always comes with the sentence explaining it
 *   - accepting an invitation sits behind a panel labelled as a development
 *     shortcut, because in production a practice cannot do it at all
 */

import { useCallback, useEffect, useState } from 'react';
import { strings } from './strings';
import { apiHeaders } from './auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
/** Deep link into the public ABN Lookup, so the attester can see the register. */
const ABR_VIEW = 'https://abr.business.gov.au/ABN/View?abn=';

const card: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  margin: '0.75rem 0',
};
const field: React.CSSProperties = { display: 'block', marginBottom: '0.5rem' };
const input: React.CSSProperties = { display: 'block', width: '100%', maxWidth: 420, padding: '0.3rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '0.25rem 1rem 0.25rem 0' };
const td: React.CSSProperties = { padding: '0.25rem 1rem 0.25rem 0', verticalAlign: 'top' };
const note: React.CSSProperties = { color: '#57606a', fontSize: '0.85rem', margin: '0.25rem 0 0.75rem' };
const GREEN = '#1a7f37';
const RED = '#cf222e';
const AMBER = '#9a6700';

interface NameMatch {
  tier: 'exact' | 'entity_suffix_insensitive';
  matched?: string;
  source?: string;
}
interface Organisation {
  id: string;
  name: string;
  abn: string;
  acn: string | null;
  legalName: string | null;
  tradingNames: string[];
  entityType: string | null;
  validationState: string;
  nameMatch?: NameMatch;
  abnVerificationSource?: string | null;
  abnSightedByName?: string | null;
}
interface OrganisationRow {
  id: string;
  name: string;
  abn: string;
  legalName: string | null;
  tradingNames: string[];
  validationState: string;
  validatedByName: string | null;
  abnVerificationSource: string | null;
  abnSightedByName: string | null;
  locationCount: number;
  activeLocationCount: number;
}
interface PendingRow {
  id: string;
  name: string;
  abn: string;
  legalName: string;
  nameMatchTier: string;
  nameMatchedOn: string | null;
  abnVerificationSource: string | null;
  abnSightedByName: string | null;
  adminName: string | null;
  adminEmail: string | null;
  adminPhone: string | null;
  adminPosition: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
  managerPosition: string | null;
  website: string | null;
  headOfficeAddress: string | null;
  credentialType: string | null;
  credentialValue: string | null;
}
interface LocationRow {
  id: string;
  code: string | null;
  address: string;
  state: string | null;
  active: boolean;
  addressValidated: boolean;
  reason?: string;
}
interface DirectoryEntry {
  practitionerId: string;
  familyName: string;
  givenNames: string;
  ahpraNumber: string;
  providerType: string;
  verified: boolean;
}
interface AffiliationRow {
  id: string;
  status: string;
  practitioner: DirectoryEntry;
  location: { id: string; address: string; code: string | null };
  department: string | null;
  providerNumber: string | null;
  startedAt: string | null;
  noticeGivenAt: string | null;
  endsAt: string | null;
  canCapture: boolean;
  blockReason: string | null;
}

/**
 * Every call funnels through here so a refusal is never swallowed.
 *
 * Headers come from apiHeaders(), which attaches the bearer token when there
 * is a session — and, importantly, prefers the TOKEN'S practice claim over the
 * id passed in. The console can ask for a practice; the token decides whether
 * it gets it. While AUTH_ENFORCE=false the server does not yet insist on the
 * token, which is exactly what the sign-in gate says on screen.
 */
async function call<T>(path: string, init?: RequestInit & { practiceId?: string }): Promise<T> {
  const headers = apiHeaders(init?.practiceId);
  const response = await fetch(`${CORE_URL}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? response.statusText);
    throw new Error(message);
  }
  return body as T;
}

export function OrgConsole() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Step 1 — registration
  // Every field starts EMPTY, with the worked example moved to a
  // placeholder. Pre-filled values read as demo data you must clear before
  // entering anything real.
  const [regName, setRegName] = useState('');
  const [regAbn, setRegAbn] = useState('');
  const [registered, setRegistered] = useState<Organisation | null>(null);
  /** Shown only after the ABR has actually failed — never offered up front. */
  const [needsAttestation, setNeedsAttestation] = useState(false);
  const [attLegalName, setAttLegalName] = useState('');
  const [attTradingNames, setAttTradingNames] = useState('');
  const [attStatus, setAttStatus] = useState('ACTIVE');
  // NO DEFAULT. Defaulting to PTY_LTD made the wrong answer the path of least
  // resistance for anyone whose entity is a trust — which then failed on the
  // ACN rule, pointing at the ABN rather than at the actual mistake.
  const [attEntityType, setAttEntityType] = useState('');
  const [attGst, setAttGst] = useState(true);
  const [attSightedBy, setAttSightedBy] = useState('');

  // The applicant block. Every one of these reaches a column — see
  // CONVENTIONS.md §9a: a field is not done until it reaches the screen.
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPosition, setAdminPosition] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [managerPosition, setManagerPosition] = useState('');
  const [website, setWebsite] = useState('');
  const [headOffice, setHeadOffice] = useState('');
  const [headOfficeIsPop, setHeadOfficeIsPop] = useState(false);
  const [credentialType, setCredentialType] = useState('');
  const [credentialValue, setCredentialValue] = useState('');

  // The entitlement check (§11), recorded at approval.
  const [entMethod, setEntMethod] = useState('');
  const [entPhone, setEntPhone] = useState('');
  const [entSource, setEntSource] = useState('');
  const [entSpokeWith, setEntSpokeWith] = useState('');

  // Step 2 — the queue
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [reviewer, setReviewer] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  // The organisation being worked on.
  //
  // Persisted, because a VALIDATED practice leaves the queue — so without this
  // a page reload strands you: the practice you just approved is no longer
  // listed anywhere you can click. The alternative (an endpoint listing every
  // organisation) is the same enumeration risk the practitioner directory
  // refuses, so it is not on offer; you can paste an id instead.
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [resumeId, setResumeId] = useState('');
  const [allOrgs, setAllOrgs] = useState<OrganisationRow[] | null>(null);
  const [orgQuery, setOrgQuery] = useState('');
  const [staleCleared, setStaleCleared] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('aob.org');
    if (saved) {
      try {
        setOrg(JSON.parse(saved) as { id: string; name: string });
      } catch {
        window.localStorage.removeItem('aob.org');
      }
    }
  }, []);

  const selectOrg = useCallback((next: { id: string; name: string } | null) => {
    setStaleCleared(false);
    setOrg(next);
    if (next) window.localStorage.setItem('aob.org', JSON.stringify(next));
    else window.localStorage.removeItem('aob.org');
  }, []);

  // Step 3
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [lastAdded, setLastAdded] = useState<LocationRow | null>(null);
  const [deptName, setDeptName] = useState('');
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; locationId: string }>>([]);

  // Step 4
  const [ahpra, setAhpra] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [givenNames, setGivenNames] = useState('');
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<DirectoryEntry | null | 'miss'>(null);

  // Step 5
  const [affiliations, setAffiliations] = useState<AffiliationRow[]>([]);
  const [inviteAhpra, setInviteAhpra] = useState('');
  const [inviteLocation, setInviteLocation] = useState('');
  const [providerNumber, setProviderNumber] = useState('');
  const [endsAt, setEndsAt] = useState('');

  // Enforced in the database too; surfaced here so it is caught before submit.
  const managerEmailClashes =
    managerEmail.trim().length > 0 && managerEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase();

  const loadQueue = useCallback(async () => {
    const result = await call<{ organisations: PendingRow[] }>('/organisations/pending');
    setPending(result.organisations);
  }, []);

  const loadAllOrgs = useCallback(async () => {
    const result = await call<{ organisations: OrganisationRow[] }>('/organisations?state=all');
    setAllOrgs(result.organisations);
  }, []);

  const loadOrgData = useCallback(async (practiceId: string) => {
    const [locs, affs, depts] = await Promise.all([
      call<LocationRow[]>('/organisations/locations', { practiceId }),
      call<AffiliationRow[]>('/affiliations', { practiceId }),
      call<Array<{ id: string; name: string; locationId: string }>>('/organisations/departments', { practiceId }),
    ]);
    setLocations(locs);
    setAffiliations(affs);
    setDepartments(depts);
    if (!inviteLocation && locs.length > 0) setInviteLocation(locs.find((l) => l.active)?.id ?? locs[0].id);
  }, [inviteLocation]);

  useEffect(() => {
    void run(async () => {
      await loadQueue();
      await loadAllOrgs();
    });
  }, [run, loadQueue, loadAllOrgs]);

  // A remembered selection is a CLAIM, not a fact. Once the real list has
  // loaded, an id that is not in it points at a practice that has been
  // deleted — and leaving it selected shows "Working on: X" while every
  // practice-scoped call quietly returns nothing.
  useEffect(() => {
    if (!org || allOrgs === null) return;
    if (allOrgs.some((o) => o.id === org.id)) return;
    setOrg(null);
    window.localStorage.removeItem('aob.org');
    setStaleCleared(true);
  }, [org, allOrgs]);

  useEffect(() => {
    if (org) void run(() => loadOrgData(org.id));
  }, [org, run, loadOrgData]);

  const refresh = () => {
    void run(async () => {
      await loadQueue();
      if (org) await loadOrgData(org.id);
    });
  };

  return (
    <div>
      <h2>{strings.org.heading}</h2>
      <p style={note}>{strings.org.intro}</p>
      {staleCleared && (
        <p
          data-testid="stale-cleared"
          style={{ color: AMBER, border: '1px solid ' + AMBER, borderRadius: 8, padding: '0.5rem 0.75rem' }}
        >
          {strings.org.staleSelection}
        </p>
      )}
      {error && (
        <p data-testid="org-error" style={{ color: RED, border: `1px solid ${RED}`, borderRadius: 8, padding: '0.5rem 0.75rem' }}>
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      <section aria-label={strings.org.registerHeading} style={card}>
        <h3>{strings.org.registerHeading}</h3>
        <p style={note}>{strings.org.offlineNote}</p>
        <label style={field}>
          {strings.org.nameLabel}
          <input style={input} value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="e.g. Sampletown Family Practice"
                data-testid="reg-name" />
        </label>
        <label style={field}>
          {strings.org.abnLabel}
          <input style={input} value={regAbn} onChange={(e) => setRegAbn(e.target.value)} placeholder="e.g. 51 824 753 556"
                data-testid="reg-abn" />
        </label>
        <h4>{strings.org.applicantHeading}</h4>
        <p style={note}>{strings.org.applicantNote}</p>
        <label style={field}>
          {strings.org.adminNameLabel}
          <input style={input} value={adminName} onChange={(e) => setAdminName(e.target.value)} data-testid="admin-name" />
        </label>
        <label style={field}>
          {strings.org.adminEmailLabel}
          <input
            style={input}
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            data-testid="admin-email"
          />
        </label>
        <label style={field}>
          {strings.org.adminPhoneLabel}
          <input style={input} value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} data-testid="admin-phone" />
        </label>
        <label style={field}>
          {strings.org.adminPositionLabel}
          <input style={input} value={adminPosition} onChange={(e) => setAdminPosition(e.target.value)} />
        </label>

        <h4>{strings.org.managerHeading}</h4>
        <label style={field}>
          {strings.org.managerNameLabel}
          <input style={input} value={managerName} onChange={(e) => setManagerName(e.target.value)} data-testid="manager-name" />
        </label>
        <label style={field}>
          {strings.org.managerEmailLabel}
          <input
            style={input}
            type="email"
            value={managerEmail}
            onChange={(e) => setManagerEmail(e.target.value)}
            data-testid="manager-email"
          />
        </label>
        {managerEmailClashes && <p style={{ color: RED }} data-testid="manager-clash">{strings.org.managerMustDiffer}</p>}
        <label style={field}>
          {strings.org.managerPhoneLabel}
          <input style={input} value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
        </label>
        <label style={field}>
          {strings.org.managerPositionLabel}
          <input style={input} value={managerPosition} onChange={(e) => setManagerPosition(e.target.value)} />
        </label>

        <h4>{strings.org.headOfficeHeading}</h4>
        <p style={note}>{strings.org.headOfficeNote}</p>
        <label style={field}>
          {strings.org.headOfficeLabel}
          <input style={input} value={headOffice} onChange={(e) => setHeadOffice(e.target.value)} data-testid="head-office" />
        </label>
        <label style={{ ...field, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={headOfficeIsPop}
            onChange={(e) => setHeadOfficeIsPop(e.target.checked)}
            data-testid="head-office-is-pop"
          />
          {strings.org.headOfficeIsPopLabel}
        </label>
        <label style={field}>
          {strings.org.websiteLabel}
          <input style={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </label>

        <h4>{strings.org.credentialHeading}</h4>
        <p style={note}>{strings.org.credentialNote}</p>
        <label style={field}>
          {strings.org.credentialTypeLabel}
          <select style={input} value={credentialType} onChange={(e) => setCredentialType(e.target.value)} data-testid="credential-type">
            <option value="">{strings.org.credentialTypePick}</option>
            <option value="ahpra">AHPRA number of a responsible practitioner — publicly checkable</option>
            <option value="hpio">HPI-O — organisation identifier</option>
            <option value="accreditation">Practice accreditation reference — verified with the accrediting body</option>
          </select>
        </label>
        <label style={field}>
          {strings.org.credentialValueLabel}
          <input
            style={input}
            value={credentialValue}
            onChange={(e) => setCredentialValue(e.target.value)}
            data-testid="credential-value"
          />
        </label>

        <button
          disabled={
            busy ||
            !regName.trim() ||
            !regAbn.trim() ||
            !adminName.trim() ||
            !adminEmail.trim() ||
            !adminPhone.trim() ||
            !headOffice.trim() ||
            managerEmailClashes
          }
          data-testid="reg-submit"
          onClick={() =>
            void run(async () => {
              const attestation =
                needsAttestation && attLegalName.trim() && attSightedBy.trim() && attEntityType
                  ? {
                      legalName: attLegalName.trim(),
                      businessNames: attTradingNames
                        .split(',')
                        .map((n) => n.trim())
                        .filter(Boolean),
                      abnStatus: attStatus,
                      entityType: attEntityType,
                      // '' is filtered out below rather than sent — the server
                      // would reject it, but with a validation message about a
                      // missing field rather than about the choice not made.

                      gstRegistered: attGst,
                      sightedByName: attSightedBy.trim(),
                    }
                  : undefined;
              try {
                const result = await call<Organisation>('/organisations', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: regName,
                    abn: regAbn,
                    adminName,
                    adminEmail,
                    adminPhone,
                    adminPosition: adminPosition || undefined,
                    managerName: managerName || undefined,
                    managerEmail: managerEmail || undefined,
                    managerPhone: managerPhone || undefined,
                    managerPosition: managerPosition || undefined,
                    website: website || undefined,
                    headOfficeAddress: headOffice,
                    headOfficeIsPlaceOfPractice: headOfficeIsPop,
                    credentialType: credentialType || undefined,
                    credentialValue: credentialValue || undefined,
                    abrAttestation: attestation,
                  }),
                });
                setRegistered(result);
                setNeedsAttestation(false);
                await loadQueue();
                await loadAllOrgs();
              } catch (err) {
                // ONLY an ABR-unavailable failure opens the manual panel. A
                // cancelled ABN or a name mismatch must never be re-typeable
                // around, so those stay plain errors.
                if ((err as Error).message.includes('no ABN lookup is configured')) setNeedsAttestation(true);
                throw err;
              }
            })
          }
        >
          {strings.org.registerButton}
        </button>

        {needsAttestation && (
          <div style={{ ...card, borderStyle: 'dashed', background: '#fff8f0' }} data-testid="attestation-panel">
            <strong>{strings.org.attestHeading}</strong>
            <p style={note}>{strings.org.attestNote}</p>
            <p>
              <a
                href={ABR_VIEW + encodeURIComponent(regAbn.replace(/[^0-9]/g, ''))}
                target="_blank"
                rel="noreferrer noopener"
              >
                {strings.org.attestOpenAbr}
              </a>
            </p>
            <label style={field}>
              {strings.org.attestLegalName}
              <input
                style={input}
                value={attLegalName}
                onChange={(e) => setAttLegalName(e.target.value)}
                placeholder="exactly as the ABR shows it"
                data-testid="att-legal-name"
              />
            </label>
            <label style={field}>
              {strings.org.attestTradingNames}
              <input style={input} value={attTradingNames} placeholder="comma separated" onChange={(e) => setAttTradingNames(e.target.value)} />
            </label>
            <label style={field}>
              {strings.org.attestStatus}
              <select style={input} value={attStatus} onChange={(e) => setAttStatus(e.target.value)} data-testid="att-status">
                <option value="ACTIVE">ACTIVE</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>
            <label style={field}>
              {strings.org.attestEntityType}
              <select
                style={input}
                value={attEntityType}
                onChange={(e) => setAttEntityType(e.target.value)}
                data-testid="att-entity-type"
              >
                <option value="">{strings.org.attestEntityTypePick}</option>
                <option value="PTY_LTD">PTY_LTD — “Australian Private Company”</option>
                <option value="PUBLIC_COMPANY">PUBLIC_COMPANY — “Australian Public Company”</option>
                <option value="INDIVIDUAL_SOLE_TRADER">INDIVIDUAL_SOLE_TRADER — “Individual/Sole Trader”</option>
                <option value="TRUST">TRUST — “The trustee for …”, “Discretionary … Trust”</option>
                <option value="PARTNERSHIP">PARTNERSHIP — “… Partnership”</option>
                <option value="OTHER">OTHER — anything else</option>
              </select>
            </label>
            <p style={note}>{strings.org.attestEntityTypeHint}</p>
            <label style={{ ...field, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={attGst} onChange={(e) => setAttGst(e.target.checked)} />
              {strings.org.attestGst}
            </label>
            <label style={field}>
              {strings.org.attestSightedBy}
              <input
                style={input}
                value={attSightedBy}
                onChange={(e) => setAttSightedBy(e.target.value)}
                placeholder="your full name"
                data-testid="att-sighted-by"
              />
            </label>
            <p style={note}>{strings.org.attestApiWins}</p>
          </div>
        )}

        {registered && (
          <div style={{ ...card, background: '#f6f8fa' }} data-testid="reg-result">
            <p>
              <strong>{registered.name}</strong> — {registered.validationState}
            </p>
            <p>
              {strings.org.legalNameLabel}: <code>{registered.legalName}</code>
            </p>
            <p>
              {strings.org.tradingNamesLabel}: <code>{registered.tradingNames.join(', ') || '—'}</code>
            </p>
            <p>
              {strings.org.acnLabel}: <code>{registered.acn ?? '—'}</code>
            </p>
            <p>
              {strings.org.entityTypeLabel}: <code>{registered.entityType}</code>
            </p>
            {registered.nameMatch && (
              <p style={{ color: registered.nameMatch.tier === 'exact' ? GREEN : AMBER }} data-testid="name-match">
                {registered.nameMatch.tier === 'exact' ? strings.org.matchExact : strings.org.matchLoose} —{' '}
                {strings.org.matchedOn} <code>{registered.nameMatch.matched}</code> ({registered.nameMatch.source})
              </p>
            )}
            <p
              style={{ color: registered.abnVerificationSource === 'abr_api' ? GREEN : AMBER }}
              data-testid="verification-source"
            >
              {registered.abnVerificationSource === 'abr_api'
                ? strings.org.verificationSourceApi
                : strings.org.verificationSourceManual + ' ' + registered.abnSightedByName}
            </p>
            <p style={note}>{strings.org.noBanking}</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      <section aria-label={strings.org.queueHeading} style={card}>
        <h3>{strings.org.queueHeading}</h3>
        <label style={field}>
          {strings.org.reviewerLabel}
          <input style={input} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="your full name"
                data-testid="reviewer" />
        </label>
        <label style={field}>
          {strings.org.rejectNoteLabel}
          <input style={input} value={rejectNote} placeholder="only needed to reject" onChange={(e) => setRejectNote(e.target.value)} data-testid="reject-note" />
        </label>
        <h4>{strings.org.entitlementHeading}</h4>
        <p style={note}>{strings.org.entitlementNote}</p>
        <label style={field}>
          {strings.org.entitlementMethodLabel}
          <select style={input} value={entMethod} onChange={(e) => setEntMethod(e.target.value)} data-testid="ent-method">
            <option value="">{strings.org.entitlementMethodPick}</option>
            <option value="phone_call">Called the practice on an independently obtained number</option>
            <option value="domain_match">Admin email domain matches the practice domain</option>
            <option value="hpio">HPI-O cross-checked</option>
            <option value="document">Sighted a document tying the person to the entity</option>
          </select>
        </label>
        {entMethod === 'phone_call' && (
          <>
            <label style={field}>
              {strings.org.entitlementPhoneLabel}
              <input style={input} value={entPhone} onChange={(e) => setEntPhone(e.target.value)} data-testid="ent-phone" />
            </label>
            <label style={field}>
              {strings.org.entitlementSourceLabel}
              <select style={input} value={entSource} onChange={(e) => setEntSource(e.target.value)} data-testid="ent-source">
                <option value="">{strings.org.entitlementSourcePick}</option>
                <option value="nhsd">National Health Services Directory</option>
                <option value="public_directory">Public directory listing</option>
                <option value="practice_website">Practice website found independently</option>
                <option value="application_form">The application form itself</option>
                <option value="other">Other</option>
              </select>
            </label>
            {entSource === 'application_form' && (
              <p style={{ color: RED }} data-testid="ent-source-warning">
                {strings.org.entitlementSourceWarning}
              </p>
            )}
            <label style={field}>
              {strings.org.entitlementSpokeWithLabel}
              <input
                style={input}
                value={entSpokeWith}
                onChange={(e) => setEntSpokeWith(e.target.value)}
                data-testid="ent-spoke-with"
              />
            </label>
          </>
        )}

        {pending.length === 0 ? (
          <p style={note}>{strings.org.queueEmpty}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse' }} data-testid="queue-table">
            <thead>
              <tr>
                <th style={th}>Applied as</th>
                <th style={th}>{strings.org.legalNameLabel}</th>
                <th style={th}>ABN</th>
                <th style={th}>{strings.org.contactCol}</th>
                <th style={th}>Match</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <td style={td}>{row.name}</td>
                  <td style={td}>{row.legalName}</td>
                  <td style={td}>
                    <code>{row.abn}</code>
                  </td>
                  <td style={td}>
                    {row.adminName} ({row.adminPosition ?? '—'})
                    <div style={{ ...note, margin: 0 }}>
                      {row.adminEmail} · {row.adminPhone}
                    </div>
                    {row.managerName ? (
                      <>
                        <div style={{ marginTop: '0.35rem' }}>
                          {row.managerName} ({row.managerPosition ?? '—'})
                        </div>
                        <div style={{ ...note, margin: 0 }}>
                          {row.managerEmail ?? '—'} · {row.managerPhone ?? '—'}
                        </div>
                      </>
                    ) : (
                      <div style={{ ...note, margin: 0, color: AMBER }}>No second contact given</div>
                    )}
                    {row.headOfficeAddress && <div style={{ ...note, margin: 0 }}>{row.headOfficeAddress}</div>}
                    {row.website && <div style={{ ...note, margin: 0 }}>{row.website}</div>}
                    {row.credentialType && (
                      <div style={{ ...note, margin: 0 }}>
                        {row.credentialType}: {row.credentialValue}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, color: row.nameMatchTier === 'exact' ? GREEN : AMBER }}>
                    {row.nameMatchTier}
                    <div style={{ ...note, color: row.abnVerificationSource === 'abr_api' ? GREEN : AMBER }}>
                      {row.abnVerificationSource === 'abr_api'
                        ? strings.org.verificationSourceApi
                        : strings.org.verificationSourceManual + ' ' + row.abnSightedByName}
                    </div>
                  </td>
                  <td style={td}>
                    <button
                      disabled={
                        busy ||
                        !reviewer.trim() ||
                        !entMethod ||
                        (entMethod === 'phone_call' && (!entPhone.trim() || !entSource || !entSpokeWith.trim()))
                      }
                      data-testid={`approve-${row.id}`}
                      onClick={() =>
                        void run(async () => {
                          await call(`/organisations/${row.id}/validate`, {
                            method: 'POST',
                            body: JSON.stringify({
                              decision: 'validated',
                              reviewerName: reviewer,
                              note: rejectNote || undefined,
                              entitlementMethod: entMethod,
                              entitlementPhoneNumber: entPhone || undefined,
                              entitlementNumberSource: entSource || undefined,
                              entitlementSpokeWithName: entSpokeWith || undefined,
                            }),
                          });
                          selectOrg({ id: row.id, name: row.name });
                          await loadQueue();
                          await loadAllOrgs();
                        })
                      }
                    >
                      {strings.org.approveButton}
                    </button>{' '}
                    <button
                      disabled={busy || !reviewer.trim() || !rejectNote.trim()}
                      onClick={() =>
                        void run(async () => {
                          await call(`/organisations/${row.id}/validate`, {
                            method: 'POST',
                            body: JSON.stringify({ decision: 'rejected', reviewerName: reviewer, note: rejectNote }),
                          });
                          await loadQueue();
                        })
                      }
                    >
                      {strings.org.rejectButton}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h4>{strings.org.findHeading}</h4>
        <p style={note}>{strings.org.findNote}</p>
        <label style={field}>
          {strings.org.findLabel}
          <input
            style={input}
            value={orgQuery}
            placeholder={strings.org.findPlaceholder}
            onChange={(e) => setOrgQuery(e.target.value)}
            data-testid="org-search"
          />
        </label>
        {allOrgs === null ? (
          <p style={note}>{strings.org.findLoading}</p>
        ) : (
          (() => {
            const q = orgQuery.trim().toLowerCase().replace(/\s+/g, '');
            const matches = allOrgs.filter((o) => {
              if (!q) return true;
              const haystack = [o.name, o.legalName ?? '', ...(o.tradingNames ?? []), o.abn]
                .join(' ')
                .toLowerCase()
                .replace(/\s+/g, '');
              return haystack.includes(q);
            });
            if (matches.length === 0) return <p style={note}>{strings.org.findNoMatches}</p>;
            return (
              <table style={{ borderCollapse: 'collapse' }} data-testid="org-search-results">
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>ABN</th>
                    <th style={th}>{strings.org.statusLabel}</th>
                    <th style={th}>{strings.org.locationsCol}</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {matches.map((o) => (
                    <tr key={o.id}>
                      <td style={td}>
                        {o.name}
                        {o.legalName && o.legalName !== o.name && (
                          <div style={{ ...note, margin: 0 }}>{o.legalName}</div>
                        )}
                        <code style={{ fontSize: '0.75rem' }}>{o.id}</code>
                      </td>
                      <td style={td}>
                        <code>{o.abn}</code>
                      </td>
                      <td style={{ ...td, color: o.validationState === 'validated' ? GREEN : AMBER }}>
                        {o.validationState}
                        {o.validatedByName && <div style={{ ...note, margin: 0 }}>by {o.validatedByName}</div>}
                      </td>
                      <td style={td}>
                        {o.activeLocationCount}/{o.locationCount} active
                      </td>
                      <td style={td}>
                        <button
                          disabled={busy || o.validationState !== 'validated'}
                          data-testid={'work-on-' + o.id}
                          onClick={() => selectOrg({ id: o.id, name: o.name })}
                        >
                          {strings.org.workOnThis}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()
        )}

        <h4>{strings.org.resumeHeading}</h4>
        <p style={note}>{strings.org.resumeNote}</p>
        <label style={field}>
          {strings.org.resumeLabel}
          <input style={input} value={resumeId} onChange={(e) => setResumeId(e.target.value)} placeholder="practice uuid"
                data-testid="resume-id" />
        </label>
        <button
          disabled={busy || !resumeId.trim()}
          data-testid="resume"
          onClick={() =>
            void run(async () => {
              // Proves the id is real and reachable before it is stored.
              await call<LocationRow[]>('/organisations/locations', { practiceId: resumeId.trim() });
              selectOrg({ id: resumeId.trim(), name: resumeId.trim().slice(0, 8) });
            })
          }
        >
          {strings.org.resumeButton}
        </button>

        {org && (
          <p data-testid="selected-org">
            Working on: <strong>{org.name}</strong> <code>{org.id}</code>{' '}
            <button onClick={refresh} disabled={busy}>
              {strings.console.refresh}
            </button>{' '}
            <button onClick={() => selectOrg(null)} disabled={busy}>
              {strings.org.clearButton}
            </button>
          </p>
        )}
      </section>

      {org && (
        <>
          {/* -------------------------------------------------------------- */}
          <section aria-label={strings.org.locationsHeading} style={card}>
            <h3>{strings.org.locationsHeading}</h3>
            <p style={note}>{strings.org.locationsOwnership}</p>
            <label style={field}>
              {strings.org.addressLabel}
              <input style={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 1 Example Street, Sampletown NSW 2000"
                data-testid="address" />
            </label>
            <label style={field}>
              {strings.org.codeLabel}
              <input style={input} value={code} placeholder="e.g. Main St" onChange={(e) => setCode(e.target.value)} />
            </label>
            <button
              disabled={busy}
              data-testid="add-location"
              onClick={() =>
                void run(async () => {
                  const created = await call<LocationRow>('/organisations/locations', {
                    method: 'POST',
                    practiceId: org.id,
                    body: JSON.stringify({ address, code: code || undefined }),
                  });
                  setLastAdded(created);
                  await loadOrgData(org.id);
                })
              }
            >
              {strings.org.addLocationButton}
            </button>
            {lastAdded?.reason && (
              <p style={{ color: AMBER, marginTop: '0.5rem' }} data-testid="location-reason">
                {lastAdded.reason}
              </p>
            )}

            {!reviewer.trim() && <p style={{ ...note, color: AMBER }}>{strings.org.needReviewer}</p>}

            {locations.length === 0 ? (
              <p style={note}>{strings.org.locationsEmpty}</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', marginTop: '0.75rem' }} data-testid="locations-table">
                <thead>
                  <tr>
                    <th style={th}>Code</th>
                    <th style={th}>{strings.org.addressLabel}</th>
                    <th style={th}>State</th>
                    <th style={th}>{strings.org.statusLabel}</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <td style={td}>{l.code ?? '—'}</td>
                      <td style={td}>{l.address}</td>
                      <td style={td}>{l.state ?? '—'}</td>
                      <td style={{ ...td, color: l.active ? GREEN : AMBER }}>
                        {l.active ? strings.org.locationActive : strings.org.locationInactive}
                      </td>
                      <td style={td}>
                        {!l.active && (
                          <button
                            disabled={busy || !reviewer.trim()}
                            data-testid={`activate-${l.id}`}
                            onClick={() =>
                              void run(async () => {
                                await call(`/organisations/locations/${l.id}/activate`, {
                                  method: 'POST',
                                  practiceId: org.id,
                                  body: JSON.stringify({ reviewerName: reviewer }),
                                });
                                setLastAdded(null);
                                await loadOrgData(org.id);
                              })
                            }
                          >
                            {strings.org.activateButton}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>{strings.org.departmentsHeading}</h4>
            <label style={field}>
              {strings.org.departmentNameLabel}
              <input style={input} value={deptName} placeholder="e.g. General Practice" onChange={(e) => setDeptName(e.target.value)} />
            </label>
            <button
              disabled={busy || locations.length === 0}
              onClick={() =>
                void run(async () => {
                  await call('/organisations/departments', {
                    method: 'POST',
                    practiceId: org.id,
                    body: JSON.stringify({ locationId: inviteLocation || locations[0].id, name: deptName }),
                  });
                  await loadOrgData(org.id);
                })
              }
            >
              {strings.org.addDepartmentButton}
            </button>
            {departments.length > 0 && (
              <p style={note}>{departments.map((d) => d.name).join(' · ')}</p>
            )}
          </section>

          {/* -------------------------------------------------------------- */}
          <section aria-label={strings.org.practitionersHeading} style={card}>
            <h3>{strings.org.practitionersHeading}</h3>
            <p style={note}>{strings.org.practitionersNoAddress}</p>
            <label style={field}>
              {strings.org.ahpraLabel}
              <input style={input} value={ahpra} onChange={(e) => setAhpra(e.target.value)} placeholder="e.g. MED0001234567"
                data-testid="ahpra" />
            </label>
            <label style={field}>
              {strings.org.familyNameLabel}
              <input style={input} value={familyName} placeholder="family name" onChange={(e) => setFamilyName(e.target.value)} />
            </label>
            <label style={field}>
              {strings.org.givenNamesLabel}
              <input style={input} value={givenNames} placeholder="given names" onChange={(e) => setGivenNames(e.target.value)} />
            </label>
            <label style={field}>
              {strings.org.emailLabel}
              <input style={input} value={email} placeholder="the practitioner’s own email" onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button
              disabled={busy}
              data-testid="pre-register"
              onClick={() =>
                void run(async () => {
                  await call('/practitioners', {
                    method: 'POST',
                    body: JSON.stringify({
                      ahpraNumber: ahpra,
                      familyName,
                      givenNames,
                      providerType: 'general_practitioner',
                      email,
                    }),
                  });
                  setInviteAhpra(ahpra);
                })
              }
            >
              {strings.org.preRegisterButton}
            </button>

            <h4>{strings.org.directoryHeading}</h4>
            <p style={note}>{strings.org.directoryNote}</p>
            <label style={field}>
              {strings.org.ahpraLabel}
              <input style={input} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="e.g. MED0001234567"
                data-testid="lookup" />
            </label>
            <button
              disabled={busy}
              data-testid="lookup-submit"
              onClick={() =>
                void run(async () => {
                  const result = await call<{ found: boolean; practitioner?: DirectoryEntry }>(
                    `/practitioners/directory?ahpraNumber=${encodeURIComponent(lookup)}`,
                  );
                  setFound(result.found && result.practitioner ? result.practitioner : 'miss');
                })
              }
            >
              {strings.org.directorySearchButton}
            </button>
            {found === 'miss' && <p style={note}>{strings.org.directoryMiss}</p>}
            {found && found !== 'miss' && (
              <p data-testid="directory-hit">
                {found.givenNames} {found.familyName} · <code>{found.ahpraNumber}</code> · {found.providerType} ·{' '}
                {found.verified ? 'ceremony complete' : 'not yet verified'}
              </p>
            )}
          </section>

          {/* -------------------------------------------------------------- */}
          <section aria-label={strings.org.affiliationsHeading} style={card}>
            <h3>{strings.org.affiliationsHeading}</h3>
            <label style={field}>
              {strings.org.ahpraLabel}
              <input style={input} value={inviteAhpra} placeholder="e.g. MED0001234567" onChange={(e) => setInviteAhpra(e.target.value)} />
            </label>
            <label style={field}>
              {strings.org.locationSelectLabel}
              <select style={input} value={inviteLocation} onChange={(e) => setInviteLocation(e.target.value)} data-testid="location-select">
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code ?? l.address} {l.active ? '' : `(${strings.org.locationInactive})`}
                  </option>
                ))}
              </select>
            </label>
            <label style={field}>
              {strings.org.providerNumberLabel}
              <input style={input} value={providerNumber} placeholder="e.g. 1234567A" onChange={(e) => setProviderNumber(e.target.value)} />
            </label>
            <button
              disabled={busy || !reviewer.trim() || !inviteLocation}
              data-testid="invite"
              onClick={() =>
                void run(async () => {
                  await call('/affiliations', {
                    method: 'POST',
                    practiceId: org.id,
                    body: JSON.stringify({
                      ahpraNumber: inviteAhpra,
                      locationId: inviteLocation,
                      providerNumber: providerNumber || undefined,
                      invitedByName: reviewer,
                    }),
                  });
                  await loadOrgData(org.id);
                })
              }
            >
              {strings.org.inviteButton}
            </button>

            {!reviewer.trim() && <p style={{ ...note, color: AMBER }}>{strings.org.needReviewer}</p>}

            {affiliations.length === 0 ? (
              <p style={note}>{strings.org.affiliationsEmpty}</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', marginTop: '0.75rem' }} data-testid="affiliations-table">
                <thead>
                  <tr>
                    <th style={th}>{strings.org.practitionerLabel}</th>
                    <th style={th}>{strings.org.locationLabel}</th>
                    <th style={th}>Provider no.</th>
                    <th style={th}>{strings.org.statusLabel}</th>
                    <th style={th}>Capture</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliations.map((a) => (
                    <tr key={a.id}>
                      <td style={td}>
                        {a.practitioner.givenNames} {a.practitioner.familyName}
                        <br />
                        <code style={{ fontSize: '0.8rem' }}>{a.practitioner.ahpraNumber}</code>
                      </td>
                      <td style={td}>{a.location.code ?? a.location.address}</td>
                      <td style={td}>
                        <code>{a.providerNumber ?? '—'}</code>
                      </td>
                      <td style={td}>
                        {a.status}
                        {a.endsAt && (
                          <>
                            <br />
                            <span style={{ fontSize: '0.8rem', color: AMBER }}>
                              ends {new Date(a.endsAt).toLocaleDateString('en-AU')}
                            </span>
                          </>
                        )}
                      </td>
                      <td style={{ ...td, maxWidth: 380 }}>
                        <span style={{ color: a.canCapture ? GREEN : RED }} data-testid={`capture-${a.id}`}>
                          {a.canCapture ? strings.org.canCaptureYes : strings.org.canCaptureNo}
                        </span>
                        {a.blockReason && <div style={note}>{a.blockReason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* The practitioner's own actions, fenced off and labelled. */}
            {affiliations.length > 0 && (
              <div style={{ ...card, borderStyle: 'dashed', background: '#fff8f0' }}>
                <strong>{strings.org.actAsPractitioner}</strong>
                <p style={note}>{strings.org.actAsNote}</p>
                {affiliations
                  .filter((a) => a.status === 'invited')
                  .map((a) => (
                    <p key={a.id}>
                      {a.practitioner.givenNames} {a.practitioner.familyName} at {a.location.code ?? a.location.address}:{' '}
                      <button
                        disabled={busy}
                        data-testid={`accept-${a.id}`}
                        onClick={() =>
                          void run(async () => {
                            await call(`/practitioners/${a.practitioner.practitionerId}/affiliations/${a.id}/respond`, {
                              method: 'POST',
                              body: JSON.stringify({ decision: 'accept' }),
                            });
                            await loadOrgData(org.id);
                          })
                        }
                      >
                        {strings.org.acceptButton}
                      </button>{' '}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await call(`/practitioners/${a.practitioner.practitionerId}/affiliations/${a.id}/respond`, {
                              method: 'POST',
                              body: JSON.stringify({ decision: 'reject' }),
                            });
                            await loadOrgData(org.id);
                          })
                        }
                      >
                        {strings.org.rejectInviteButton}
                      </button>
                    </p>
                  ))}

                <h4>{strings.org.noticeHeading}</h4>
                <p style={note}>{strings.org.noticeNote}</p>
                <label style={field}>
                  {strings.org.endsAtLabel}
                  <input
                    type="date"
                    style={input}
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    data-testid="ends-at"
                  />
                </label>
                {affiliations
                  .filter((a) => a.status === 'active' || a.status === 'ending')
                  .map((a) => (
                    <p key={a.id}>
                      {a.practitioner.givenNames} {a.practitioner.familyName}:{' '}
                      {a.status === 'ending' ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await call(`/affiliations/${a.id}/notice/withdraw`, { method: 'POST', practiceId: org.id });
                              await loadOrgData(org.id);
                            })
                          }
                        >
                          {strings.org.withdrawNoticeButton}
                        </button>
                      ) : (
                        <button
                          disabled={busy || !endsAt || !reviewer.trim()}
                          data-testid={`notice-${a.id}`}
                          onClick={() =>
                            void run(async () => {
                              await call(`/affiliations/${a.id}/notice`, {
                                method: 'POST',
                                practiceId: org.id,
                                body: JSON.stringify({
                                  endsAt: new Date(`${endsAt}T00:00:00.000Z`).toISOString(),
                                  givenByName: reviewer,
                                }),
                              });
                              await loadOrgData(org.id);
                            })
                          }
                        >
                          {strings.org.giveNoticeButton}
                        </button>
                      )}{' '}
                      <button
                        disabled={busy}
                        data-testid={`deregister-${a.id}`}
                        onClick={() =>
                          void run(async () => {
                            await call(`/practitioners/${a.practitioner.practitionerId}/deregister`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: 'AHPRA registration lapsed' }),
                            });
                            await loadOrgData(org.id);
                          })
                        }
                      >
                        {strings.org.deregisterButton}
                      </button>
                    </p>
                  ))}
                <p style={note}>{strings.org.deregisterNote}</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
