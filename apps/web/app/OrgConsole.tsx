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
/** Deep link into the AHPRA public register search. */
import { EXTERNAL_LINKS, abnLookupUrl } from '@aobplatform/domain';

const AHPRA_SEARCH = EXTERNAL_LINKS.ahpraRegister.url;

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
interface CheckDefinition {
  key: string;
  category: string;
  label: string;
  weight: string;
  whatItProves: string;
  evidenceGuidance: string;
  evidenceRequired: boolean;
  requiredFields?: string[];
}
interface CheckHistoryRow {
  id: string;
  checkKey: string;
  outcome: string;
  reasonCode: string | null;
  note: string | null;
  performedByName: string;
  performedAt: string;
  artefacts: Array<{ id: string; filename: string }>;
}
interface CheckSummaryResponse {
  checklistVersion: string;
  summary: { score: number; passed: number; failed: number; notApplicable: number; incomplete: number };
  admission: { wouldPass: boolean; reasons: string[] };
  history: CheckHistoryRow[];
}
interface CredentialRow {
  id: string;
  credentialType: string;
  credentialValue: string;
  label: string | null;
  verified: boolean;
  verifiedByName: string | null;
  verificationMethod: string | null;
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

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;

interface AddressFields {
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

const emptyAddress = (): AddressFields => ({
  line1: '',
  line2: '',
  suburb: '',
  state: '',
  postcode: '',
  country: 'Australia',
});

/**
 * The six fields, declared once rather than twice.
 *
 * `idPrefix` keeps the test ids distinct between the head office and a
 * location — without it both blocks would answer to the same selector and a
 * test could pass while filling in the wrong form.
 */
function AddressFieldset({
  value,
  onChange,
  idPrefix,
}: {
  value: AddressFields;
  onChange: (next: AddressFields) => void;
  idPrefix: string;
}) {
  const set = (key: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <>
      <label style={field}>
        {strings.org.line1Label}
        <input style={input} value={value.line1} onChange={set('line1')} data-testid={idPrefix + '-line1'} />
      </label>
      <label style={field}>
        {strings.org.line2Label}
        <input style={input} value={value.line2} onChange={set('line2')} data-testid={idPrefix + '-line2'} />
      </label>
      <label style={field}>
        {strings.org.suburbLabel}
        <input style={input} value={value.suburb} onChange={set('suburb')} data-testid={idPrefix + '-suburb'} />
      </label>
      <label style={field}>
        {strings.org.stateLabel}
        <select style={input} value={value.state} onChange={set('state')} data-testid={idPrefix + '-state'}>
          <option value="">{strings.org.statePick}</option>
          {AU_STATES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </label>
      <label style={field}>
        {strings.org.postcodeLabel}
        <input
          style={input}
          value={value.postcode}
          onChange={set('postcode')}
          inputMode="numeric"
          maxLength={4}
          data-testid={idPrefix + '-postcode'}
        />
      </label>
      <label style={field}>
        {strings.org.countryLabel}
        <input style={input} value={value.country} onChange={set('country')} data-testid={idPrefix + '-country'} />
      </label>
    </>
  );
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
  const [headOffice, setHeadOffice] = useState<AddressFields>(emptyAddress());
  const [headOfficeIsPop, setHeadOfficeIsPop] = useState(false);
  const [credentialType, setCredentialType] = useState('');
  const [credentialValue, setCredentialValue] = useState('');
  const [credentialLabel, setCredentialLabel] = useState('');
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [credVerifyBy, setCredVerifyBy] = useState('');
  const [credVerifyMethod, setCredVerifyMethod] = useState('');

  // The checklist.
  const [catalogue, setCatalogue] = useState<{
    checks: CheckDefinition[];
    failureReasons: string[];
    incompleteReasons: string[];
  } | null>(null);
  const [checkState, setCheckState] = useState<CheckSummaryResponse | null>(null);
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const [checkOutcome, setCheckOutcome] = useState('');
  const [checkReason, setCheckReason] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const [checkBy, setCheckBy] = useState('');
  const [checkFields, setCheckFields] = useState<Record<string, string>>({});
  const [pendingArtefacts, setPendingArtefacts] = useState<Array<{ id: string; filename: string }>>([]);

  // The entitlement check (§11), recorded at approval.
  const [entMethod, setEntMethod] = useState('');
  const [entPhone, setEntPhone] = useState('');
  const [entSource, setEntSource] = useState('');
  const [entSpokeWith, setEntSpokeWith] = useState('');
  /** What the approval actually did — account created, invited, notified. */
  const [followUp, setFollowUp] = useState<string | null>(null);

  // The AHPRA register check (step 4).
  const [ahStatus, setAhStatus] = useState('');
  const [ahProfession, setAhProfession] = useState('');
  const [ahDivision, setAhDivision] = useState('');
  const [ahConditions, setAhConditions] = useState('None');
  const [ahUndertakings, setAhUndertakings] = useState('None');
  const [ahReprimands, setAhReprimands] = useState('None');
  const [ahSuburb, setAhSuburb] = useState('');
  const [ahState, setAhState] = useState('');
  const [ahPostcode, setAhPostcode] = useState('');
  const [ahCountry, setAhCountry] = useState('Australia');
  const [ahSightedBy, setAhSightedBy] = useState('');
  const [ahTypes, setAhTypes] = useState<Array<{ registrationType: string; specialty: string; expiryDate: string }>>([
    { registrationType: 'General', specialty: '', expiryDate: '' },
  ]);
  const [ahResult, setAhResult] = useState<{
    permitted: boolean;
    refusal: string | null;
    warnings: Array<{ code: string; message: string }>;
  } | null>(null);

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
  const [address, setAddress] = useState<AddressFields>(emptyAddress());
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

  const loadCatalogue = useCallback(async () => {
    const result = await call<{ checks: CheckDefinition[]; failureReasons: string[]; incompleteReasons: string[] }>(
      '/organisations/checks/catalogue',
    );
    setCatalogue(result);
  }, []);

  const loadAllOrgs = useCallback(async () => {
    const result = await call<{ organisations: OrganisationRow[] }>('/organisations?state=all');
    setAllOrgs(result.organisations);
  }, []);

  const loadOrgData = useCallback(async (practiceId: string) => {
    const [locs, affs, depts, creds, checkSummary] = await Promise.all([
      call<LocationRow[]>('/organisations/locations', { practiceId }),
      call<AffiliationRow[]>('/affiliations', { practiceId }),
      call<Array<{ id: string; name: string; locationId: string }>>('/organisations/departments', { practiceId }),
      call<CredentialRow[]>('/organisations/credentials', { practiceId }),
      call<CheckSummaryResponse>('/organisations/checks', { practiceId }),
    ]);
    setCredentials(creds);
    setCheckState(checkSummary);
    setLocations(locs);
    setAffiliations(affs);
    setDepartments(depts);
    if (!inviteLocation && locs.length > 0) setInviteLocation(locs.find((l) => l.active)?.id ?? locs[0].id);
  }, [inviteLocation]);

  useEffect(() => {
    void run(async () => {
      await loadQueue();
      await loadAllOrgs();
      await loadCatalogue();
    });
  }, [run, loadQueue, loadAllOrgs, loadCatalogue]);

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
        <p style={note}>{strings.org.addressStructuredNote}</p>
        <AddressFieldset value={headOffice} onChange={setHeadOffice} idPrefix="head-office" />
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
            !headOffice.line1.trim() ||
            !headOffice.suburb.trim() ||
            !headOffice.state ||
            !headOffice.postcode.trim() ||
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
                    headOfficeLine1: headOffice.line1,
                    headOfficeLine2: headOffice.line2 || undefined,
                    headOfficeSuburb: headOffice.suburb,
                    headOfficeState: headOffice.state,
                    headOfficePostcode: headOffice.postcode,
                    headOfficeCountry: headOffice.country || undefined,
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
                href={abnLookupUrl(regAbn)}
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
                          const result = await call<{ followUp?: { detail: string } }>(`/organisations/${row.id}/validate`, {
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
                          setFollowUp(result?.followUp?.detail ?? null);
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
                          const rejected = await call<{ followUp?: { detail: string } }>(
                            `/organisations/${row.id}/validate`,
                            {
                              method: 'POST',
                              body: JSON.stringify({ decision: 'rejected', reviewerName: reviewer, note: rejectNote }),
                            },
                          );
                          setFollowUp(rejected?.followUp?.detail ?? null);
                          await loadQueue();
                          await loadAllOrgs();
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

        {followUp && (
          <p
            data-testid="follow-up"
            style={{ border: '1px solid ' + GREEN, borderRadius: 8, padding: '0.5rem 0.75rem', color: GREEN }}
          >
            <strong>{strings.org.followUpHeading}:</strong> {followUp}
          </p>
        )}

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
            <p style={note}>{strings.org.addressStructuredNote}</p>
            <AddressFieldset value={address} onChange={setAddress} idPrefix="location" />
            <label style={field}>
              {strings.org.codeLabel}
              <input style={input} value={code} placeholder="e.g. Main St" onChange={(e) => setCode(e.target.value)} />
            </label>
            <button
              disabled={busy || !address.line1.trim() || !address.suburb.trim() || !address.state || !address.postcode.trim()}
              data-testid="add-location"
              onClick={() =>
                void run(async () => {
                  const created = await call<LocationRow>('/organisations/locations', {
                    method: 'POST',
                    practiceId: org.id,
                    body: JSON.stringify({
                      addressLine1: address.line1,
                      addressLine2: address.line2 || undefined,
                      suburb: address.suburb,
                      state: address.state,
                      postcode: address.postcode,
                      country: address.country || undefined,
                      code: code || undefined,
                    }),
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

            <h4>{strings.org.checklistHeading}</h4>
            <p style={note}>{strings.org.checklistNote}</p>

            {checkState && (
              <div
                style={{
                  ...card,
                  borderColor: checkState.admission.wouldPass ? GREEN : AMBER,
                  background: '#f6f8fa',
                }}
                data-testid="check-summary"
              >
                <p style={{ margin: 0, color: checkState.admission.wouldPass ? GREEN : AMBER }}>
                  <strong>
                    {checkState.admission.wouldPass ? strings.org.checkWouldPassYes : strings.org.checkWouldPassNo}
                  </strong>{' '}
                  · {strings.org.checkScoreLabel} {checkState.summary.score}
                </p>
                {checkState.admission.reasons.length > 0 && (
                  <ul style={{ margin: '0.4rem 0 0 1.1rem' }}>
                    {checkState.admission.reasons.map((reason) => (
                      <li key={reason} style={{ fontSize: '0.85rem', color: AMBER }}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
                <p style={note}>{strings.org.checkSoftNote}</p>
                <p style={{ ...note, margin: 0 }}>{strings.org.checkNotShownToApplicant}</p>
              </div>
            )}

            {catalogue?.checks.map((definition) => {
              const history = (checkState?.history ?? []).filter((h) => h.checkKey === definition.key);
              const latest = history[history.length - 1];
              const isOpen = openCheck === definition.key;
              const outcomeColour =
                latest?.outcome === 'passed'
                  ? GREEN
                  : latest?.outcome === 'failed'
                    ? RED
                    : latest
                      ? AMBER
                      : '#57606a';
              return (
                <div key={definition.key} style={{ ...card, margin: '0.5rem 0' }} data-testid={'check-' + definition.key}>
                  <p style={{ margin: 0 }}>
                    <strong>{definition.label}</strong>{' '}
                    <span style={{ ...note, margin: 0 }}>
                      {definition.weight}
                      {definition.evidenceRequired ? ' · evidence required to pass' : ''}
                    </span>
                  </p>
                  <p style={{ ...note, margin: '0.25rem 0' }}>{definition.whatItProves}</p>
                  <p style={{ margin: '0.25rem 0', color: outcomeColour }}>
                    {latest ? (
                      <>
                        {latest.outcome} — {latest.performedByName},{' '}
                        {new Date(latest.performedAt).toLocaleDateString('en-AU')}
                        {history.length > 1 && ` (${history.length} attempts)`}
                        {latest.artefacts.length > 0 && ` · ${latest.artefacts.length} attached`}
                      </>
                    ) : (
                      strings.org.checkNever
                    )}
                  </p>
                  <button
                    disabled={busy}
                    data-testid={'open-' + definition.key}
                    onClick={() => {
                      setOpenCheck(isOpen ? null : definition.key);
                      setCheckOutcome('');
                      setCheckReason('');
                      setCheckNote('');
                      setCheckFields({});
                      setPendingArtefacts([]);
                    }}
                  >
                    {isOpen ? 'Close' : 'Perform this check'}
                  </button>

                  {isOpen && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <p style={{ ...note, color: AMBER }}>
                        <strong>{strings.org.checkEvidenceHeading}:</strong> {definition.evidenceGuidance}
                      </p>

                      <label style={field}>
                        {strings.org.checkOutcomeLabel}
                        <select
                          style={input}
                          value={checkOutcome}
                          onChange={(e) => {
                            setCheckOutcome(e.target.value);
                            setCheckReason('');
                          }}
                          data-testid="check-outcome"
                        >
                          <option value="">{strings.org.checkOutcomePick}</option>
                          <option value="passed">Passed</option>
                          <option value="failed">Failed</option>
                          <option value="not_applicable">Not applicable here</option>
                          <option value="could_not_complete">Could not complete</option>
                        </select>
                      </label>

                      {(checkOutcome === 'failed' || checkOutcome === 'could_not_complete') && (
                        <label style={field}>
                          {strings.org.checkReasonLabel}
                          <select
                            style={input}
                            value={checkReason}
                            onChange={(e) => setCheckReason(e.target.value)}
                            data-testid="check-reason"
                          >
                            <option value="">{strings.org.checkReasonPick}</option>
                            {(checkOutcome === 'failed' ? catalogue.failureReasons : catalogue.incompleteReasons).map(
                              (reason) => (
                                <option key={reason} value={reason}>
                                  {reason.replace(/_/g, ' ')}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      )}

                      {(definition.requiredFields ?? []).map((fieldName) => (
                        <label style={field} key={fieldName}>
                          {fieldName}
                          <input
                            style={input}
                            value={checkFields[fieldName] ?? ''}
                            onChange={(e) => setCheckFields({ ...checkFields, [fieldName]: e.target.value })}
                            data-testid={'check-field-' + fieldName}
                          />
                        </label>
                      ))}

                      <label style={field}>
                        {strings.org.checkNoteLabel}
                        <input
                          style={input}
                          value={checkNote}
                          onChange={(e) => setCheckNote(e.target.value)}
                          data-testid="check-note"
                        />
                      </label>
                      <label style={field}>
                        {strings.org.checkPerformedBy}
                        <input
                          style={input}
                          value={checkBy}
                          onChange={(e) => setCheckBy(e.target.value)}
                          data-testid="check-by"
                        />
                      </label>

                      <p style={{ margin: '0.25rem 0' }}>
                        {pendingArtefacts.length === 0
                          ? strings.org.checkNoEvidence
                          : `${strings.org.checkAttached}: ${pendingArtefacts.map((a) => a.filename).join(', ')}`}
                      </p>
                      <input
                        type="file"
                        data-testid="check-file"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void run(async () => {
                            const buffer = await file.arrayBuffer();
                            let binary = '';
                            const view = new Uint8Array(buffer);
                            for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
                            const uploaded = await call<{ id: string; filename: string }>('/artefacts', {
                              method: 'POST',
                              practiceId: org.id,
                              body: JSON.stringify({
                                contentBase64: btoa(binary),
                                declaredContentType: file.type,
                                filename: file.name,
                                purpose:
                                  definition.category === 'entitlement' ? 'entitlement_call' : 'credential',
                                uploadedByName: checkBy || 'unattributed',
                              }),
                            });
                            setPendingArtefacts((current) => [...current, uploaded]);
                          });
                        }}
                      />

                      <p style={{ marginTop: '0.5rem' }}>
                        <button
                          disabled={busy || !checkOutcome || !checkBy.trim()}
                          data-testid="record-check"
                          onClick={() =>
                            void run(async () => {
                              await call('/organisations/checks', {
                                method: 'POST',
                                practiceId: org.id,
                                body: JSON.stringify({
                                  checkKey: definition.key,
                                  outcome: checkOutcome,
                                  performedByName: checkBy,
                                  reasonCode: checkReason || undefined,
                                  note: checkNote || undefined,
                                  fields: checkFields,
                                  artefactIds: pendingArtefacts.map((a) => a.id),
                                }),
                              });
                              setOpenCheck(null);
                              setPendingArtefacts([]);
                              await loadOrgData(org.id);
                            })
                          }
                        >
                          {strings.org.checkRecord}
                        </button>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            <h4>{strings.org.credentialsHeading}</h4>
            <p style={note}>{strings.org.credentialVerifyNote}</p>
            {credentials.length === 0 ? (
              <p style={note}>{strings.org.credentialsEmpty}</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', marginBottom: '0.75rem' }} data-testid="credentials-table">
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>Number / reference</th>
                    <th style={th}>Status</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((c) => (
                    <tr key={c.id}>
                      <td style={td}>
                        {c.credentialType}
                        {c.label && <div style={{ ...note, margin: 0 }}>{c.label}</div>}
                      </td>
                      <td style={td}>
                        <code>{c.credentialValue}</code>
                      </td>
                      <td style={{ ...td, color: c.verified ? GREEN : AMBER }}>
                        {c.verified ? (
                          <>
                            {strings.org.credentialVerified} {c.verifiedByName}
                            <div style={{ ...note, margin: 0 }}>{c.verificationMethod}</div>
                          </>
                        ) : (
                          strings.org.credentialUnverified
                        )}
                      </td>
                      <td style={td}>
                        {!c.verified && (
                          <button
                            disabled={busy || !credVerifyBy.trim() || !credVerifyMethod}
                            data-testid={'verify-cred-' + c.id}
                            onClick={() =>
                              void run(async () => {
                                await call(`/organisations/credentials/${c.id}/verify`, {
                                  method: 'POST',
                                  practiceId: org.id,
                                  body: JSON.stringify({
                                    verifiedByName: credVerifyBy,
                                    verificationMethod: credVerifyMethod,
                                  }),
                                });
                                await loadOrgData(org.id);
                              })
                            }
                          >
                            {strings.org.credentialVerifyButton}
                          </button>
                        )}{' '}
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await call(`/organisations/credentials/${c.id}/remove`, {
                                method: 'POST',
                                practiceId: org.id,
                              });
                              await loadOrgData(org.id);
                            })
                          }
                        >
                          {strings.org.credentialRemove}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h5>{strings.org.credentialVerifyHeading}</h5>
            <label style={field}>
              {strings.org.credentialVerifyBy}
              <input
                style={input}
                value={credVerifyBy}
                onChange={(e) => setCredVerifyBy(e.target.value)}
                data-testid="cred-verify-by"
              />
            </label>
            <label style={field}>
              {strings.org.credentialVerifyMethod}
              <select
                style={input}
                value={credVerifyMethod}
                onChange={(e) => setCredVerifyMethod(e.target.value)}
                data-testid="cred-verify-method"
              >
                <option value="">{strings.org.credentialTypePick}</option>
                <option value="ahpra_register">Looked it up on the AHPRA public register</option>
                <option value="hi_service">Confirmed with the Healthcare Identifiers Service</option>
                <option value="accrediting_body">Confirmed with the accrediting body</option>
                <option value="document_sighted">Sighted a document</option>
              </select>
            </label>

            <h5>{strings.org.credentialAddAnother}</h5>
            <label style={field}>
              {strings.org.credentialTypeLabel}
              <select
                style={input}
                value={credentialType}
                onChange={(e) => setCredentialType(e.target.value)}
                data-testid="add-cred-type"
              >
                <option value="">{strings.org.credentialTypePick}</option>
                <option value="ahpra">AHPRA number of a responsible practitioner</option>
                <option value="hpio">HPI-O</option>
                <option value="accreditation">Practice accreditation reference</option>
                <option value="nash">NASH certificate</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style={field}>
              {strings.org.credentialValueLabel}
              <input
                style={input}
                value={credentialValue}
                onChange={(e) => setCredentialValue(e.target.value)}
                data-testid="add-cred-value"
              />
            </label>
            <label style={field}>
              {strings.org.credentialLabelLabel}
              <input style={input} value={credentialLabel} onChange={(e) => setCredentialLabel(e.target.value)} />
            </label>
            <button
              disabled={busy || !credentialType || !credentialValue.trim()}
              data-testid="add-cred"
              onClick={() =>
                void run(async () => {
                  await call('/organisations/credentials', {
                    method: 'POST',
                    practiceId: org.id,
                    body: JSON.stringify({
                      credentialType,
                      credentialValue,
                      label: credentialLabel || undefined,
                      addedByName: reviewer || undefined,
                    }),
                  });
                  setCredentialValue('');
                  setCredentialLabel('');
                  await loadOrgData(org.id);
                })
              }
            >
              {strings.org.credentialAdd}
            </button>

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
                      // `|| undefined`, not the raw value: an empty string is
                      // not "absent" to class-validator, it is a value that
                      // fails @IsEmail. Sending '' for an optional field turns
                      // "I left this blank" into "email must be an email".
                      email: email.trim() || undefined,
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

            {found && found !== 'miss' && (
              <div style={{ ...card, background: '#f6f8fa' }} data-testid="ahpra-panel">
                <h4 style={{ marginTop: 0 }}>{strings.org.ahpraHeading}</h4>
                <p style={note}>{strings.org.ahpraNote}</p>
                <p>
                  <a href={AHPRA_SEARCH} target="_blank" rel="noreferrer noopener">
                    {strings.org.ahpraOpen}
                  </a>{' '}
                  — search <code>{found.ahpraNumber}</code>
                </p>

                <label style={field}>
                  {strings.org.ahpraStatusLabel}
                  <select style={input} value={ahStatus} onChange={(e) => setAhStatus(e.target.value)} data-testid="ah-status">
                    <option value="">{strings.org.ahpraStatusPick}</option>
                    <option value="Registered">Registered</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Cancelled">Cancelled</option>
                    <option value="Surrendered">Surrendered</option>
                    <option value="Lapsed">Lapsed</option>
                    <option value="Not currently registered">Not currently registered</option>
                  </select>
                </label>
                <label style={field}>
                  {strings.org.ahpraProfessionLabel}
                  <input style={input} value={ahProfession} onChange={(e) => setAhProfession(e.target.value)} placeholder="e.g. Medical Practitioner" />
                </label>
                <label style={field}>
                  {strings.org.ahpraDivisionLabel}
                  <input style={input} value={ahDivision} onChange={(e) => setAhDivision(e.target.value)} placeholder="e.g. General" />
                </label>
                <label style={field}>
                  {strings.org.ahpraConditionsLabel}
                  <input style={input} value={ahConditions} onChange={(e) => setAhConditions(e.target.value)} data-testid="ah-conditions" />
                </label>
                <label style={field}>
                  {strings.org.ahpraUndertakingsLabel}
                  <input style={input} value={ahUndertakings} onChange={(e) => setAhUndertakings(e.target.value)} />
                </label>
                <label style={field}>
                  {strings.org.ahpraReprimandsLabel}
                  <input style={input} value={ahReprimands} onChange={(e) => setAhReprimands(e.target.value)} />
                </label>

                <h5 style={{ marginBottom: '0.25rem' }}>{strings.org.ahpraPrincipalHeading}</h5>
                <p style={note}>{strings.org.ahpraNoAddressNote}</p>
                <label style={field}>
                  {strings.org.ahpraSuburbLabel}
                  <input style={input} value={ahSuburb} onChange={(e) => setAhSuburb(e.target.value)} />
                </label>
                <label style={field}>
                  {strings.org.ahpraStateLabel}
                  <input style={input} value={ahState} onChange={(e) => setAhState(e.target.value)} />
                </label>
                <label style={field}>
                  {strings.org.ahpraPostcodeLabel}
                  <input style={input} value={ahPostcode} onChange={(e) => setAhPostcode(e.target.value)} />
                </label>
                <label style={field}>
                  {strings.org.ahpraCountryLabel}
                  <input style={input} value={ahCountry} onChange={(e) => setAhCountry(e.target.value)} />
                </label>

                <h5>{strings.org.ahpraTypesHeading}</h5>
                {ahTypes.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                    <input
                      style={{ ...input, maxWidth: 160 }}
                      value={t.registrationType}
                      placeholder={strings.org.ahpraTypeLabel}
                      data-testid={'ah-type-' + i}
                      onChange={(e) =>
                        setAhTypes(ahTypes.map((x, j) => (i === j ? { ...x, registrationType: e.target.value } : x)))
                      }
                    />
                    <input
                      style={{ ...input, maxWidth: 180 }}
                      value={t.specialty}
                      placeholder={strings.org.ahpraSpecialtyLabel}
                      onChange={(e) => setAhTypes(ahTypes.map((x, j) => (i === j ? { ...x, specialty: e.target.value } : x)))}
                    />
                    <input
                      type="date"
                      style={{ ...input, maxWidth: 170 }}
                      value={t.expiryDate}
                      data-testid={'ah-expiry-' + i}
                      onChange={(e) => setAhTypes(ahTypes.map((x, j) => (i === j ? { ...x, expiryDate: e.target.value } : x)))}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setAhTypes([...ahTypes, { registrationType: '', specialty: '', expiryDate: '' }])}
                  disabled={busy}
                >
                  {strings.org.ahpraAddType}
                </button>

                <label style={field}>
                  {strings.org.ahpraSightedByLabel}
                  <input style={input} value={ahSightedBy} onChange={(e) => setAhSightedBy(e.target.value)} data-testid="ah-sighted-by" />
                </label>
                <button
                  disabled={busy || !ahStatus || !ahSightedBy.trim()}
                  data-testid="ah-submit"
                  onClick={() =>
                    void run(async () => {
                      const result = await call<{
                        permitted: boolean;
                        refusal: string | null;
                        warnings: Array<{ code: string; message: string }>;
                      }>(`/practitioners/${found.practitionerId}/registration`, {
                        method: 'POST',
                        body: JSON.stringify({
                          registrationStatus: ahStatus,
                          profession: ahProfession || undefined,
                          division: ahDivision || undefined,
                          conditions: ahConditions || undefined,
                          undertakings: ahUndertakings || undefined,
                          reprimands: ahReprimands || undefined,
                          principalSuburb: ahSuburb || undefined,
                          principalState: ahState || undefined,
                          principalPostcode: ahPostcode || undefined,
                          principalCountry: ahCountry || undefined,
                          source: 'ahpra_manual',
                          sightedByName: ahSightedBy,
                          registrationTypes: ahTypes
                            .filter((t) => t.registrationType.trim())
                            .map((t) => ({
                              registrationType: t.registrationType,
                              specialty: t.specialty || undefined,
                              expiryDate: t.expiryDate ? new Date(t.expiryDate + 'T00:00:00Z').toISOString() : undefined,
                            })),
                        }),
                      });
                      setAhResult(result);
                      if (org) await loadOrgData(org.id);
                    })
                  }
                >
                  {strings.org.ahpraSubmit}
                </button>

                {ahResult && (
                  <div style={{ marginTop: '0.75rem' }} data-testid="ah-result">
                    <p style={{ color: ahResult.permitted ? GREEN : RED }}>
                      <strong>{ahResult.permitted ? strings.org.ahpraPermitted : strings.org.ahpraRefused}</strong>
                    </p>
                    {ahResult.refusal && <p style={{ color: RED }}>{ahResult.refusal}</p>}
                    {ahResult.warnings.length > 0 && (
                      <>
                        <strong>{strings.org.ahpraWarningsHeading}</strong>
                        <ul style={{ margin: '0.4rem 0 0 1.1rem' }}>
                          {ahResult.warnings.map((w) => (
                            <li key={w.code} style={{ color: AMBER, fontSize: '0.85rem' }}>
                              {w.message}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
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
