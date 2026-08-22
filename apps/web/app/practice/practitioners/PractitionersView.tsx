'use client';

/**
 * The practice's roster of practitioners.
 *
 * THE ONE FACT THIS PAGE IS ABOUT: has a human actually looked at the AHPRA
 * public register for this person? Everything else here is in service of that.
 *
 * Entering a registration number proves nothing. A fraudster types an invented
 * one as easily as a real one, so a score that counted entry would be measuring
 * effort at the keyboard (IDENTITY-STRENGTH-DESIGN.md §1). What carries weight
 * is a recorded check with a named human against it — so an unchecked
 * practitioner is shown as unchecked, prominently, rather than as a tidy row
 * that looks the same as a verified one.
 *
 * ADDING SOMEONE HERE IS NOT PUTTING THEM AT A LOCATION, and the page says so
 * twice, because that is the single most likely misunderstanding. Creating the
 * identity is ours to do; affiliating them is an invitation only THEY can
 * accept. A practice that could do both would be a practice that can sign in a
 * doctor's name, which is exactly the impersonation REQ-PKI-01 exists to stop.
 *
 * WORST FIRST: deregistered, then unchecked, then everybody else.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  UserPlus,
  UserSquare,
} from 'lucide-react';
import { AHPRA_REGISTRATION_STATUSES, isValidAhpraNumberFormat } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Where a person goes to do the check this page records. */
const AHPRA_REGISTER = 'https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx';

const PROVIDER_TYPES = [
  'general_practitioner',
  'specialist',
  'nurse_practitioner',
  'optometrist',
  'allied_health',
  'other',
] as const;

const REGISTRATION_TYPES = ['General', 'Specialist', 'Limited', 'Provisional', 'Non-practising'] as const;

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

interface RosterEntry {
  practitionerId: string;
  familyName: string;
  givenNames: string;
  ahpraNumber: string;
  providerType: string;
  verified: boolean;
  email?: string | null;
  hasEmail: boolean;
  invitedByThisPractice: boolean;
  registrationStatus: string | null;
  profession: string | null;
  conditions: string | null;
  registrationSightedByName: string | null;
  registrationSightedAt: string | null;
  registrationSource: string | null;
  registerChecked: boolean;
  deregisteredAt: string | null;
  affiliationCount: number;
  activeAffiliationCount: number;
  invitedAffiliationCount: number;
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

function displayDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PractitionersView({ practiceId }: { practiceId: string }) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const headers = { 'x-practice-id': practiceId, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practitioners`, { headers: { 'x-practice-id': practiceId } });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setRoster(await res.json());
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <Notice tone="stop" title={strings.practitioners.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  // Deregistered first — it is a hard stop and the only genuinely urgent state
  // on this page. Then unchecked, which is work. Then the rest, alphabetically
  // as the server returned them.
  const rank = (p: RosterEntry) => (p.deregisteredAt ? 0 : p.registerChecked ? 2 : 1);
  const ordered = roster ? [...roster].sort((a, b) => rank(a) - rank(b)) : [];
  const checked = ordered.filter((p) => p.registerChecked).length;
  const unchecked = ordered.length - checked;

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={styles.crumb} data-testid="practitioners-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.practitioners.backToSetup}
      </Link>

      <h1 className={ui.pageTitle}>{strings.practitioners.title}</h1>
      <p className={ui.pageLead}>{strings.practitioners.lead}</p>

      {roster === null && <p className={ui.hint}>{strings.practitioners.loading}</p>}

      {roster !== null && roster.length > 0 && (
        <p className={styles.tally}>
          <span>
            {roster.length === 1
              ? strings.practitioners.countOne
              : strings.practitioners.countMany.replace('{n}', String(roster.length))}
          </span>
          {checked > 0 && (
            <Chip tone="ok">{strings.practitioners.checkedCount.replace('{n}', String(checked))}</Chip>
          )}
          {unchecked > 0 && (
            <Chip tone="warn">{strings.practitioners.uncheckedCount.replace('{n}', String(unchecked))}</Chip>
          )}
        </p>
      )}

      {roster !== null && roster.length === 0 && (
        <div className={styles.empty}>
          <UserSquare size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.practitioners.emptyTitle}</p>
          <p className={ui.hint}>{strings.practitioners.emptyBody}</p>
        </div>
      )}

      <ul className={styles.list}>
        {ordered.map((p) => (
          <PractitionerCard key={p.practitionerId} entry={p} headers={headers} onChanged={load} />
        ))}
      </ul>

      <AddPractitioner
        headers={headers}
        added={added}
        onAdded={() => {
          setAdded(true);
          void load();
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// One practitioner
// ---------------------------------------------------------------------------

function PractitionerCard({
  entry,
  headers,
  onChanged,
}: {
  entry: RosterEntry;
  headers: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);

  const deregistered = Boolean(entry.deregisteredAt);
  const tone = deregistered ? styles.cardStopped : entry.registerChecked ? styles.cardOk : styles.cardNeedsWork;

  return (
    <li className={`${styles.card} ${tone}`} data-testid={`practitioner-${entry.practitionerId}`}>
      <div className={styles.cardHead}>
        <UserSquare size={18} aria-hidden="true" className={styles.cardIcon} />
        <div className={styles.cardMain}>
          {/* Family name first, as a register lists them and as anybody
              scanning a column expects to read them. */}
          <p className={styles.cardTitle}>
            {entry.familyName}, {entry.givenNames}
          </p>
          <p className={styles.cardSub}>
            {entry.ahpraNumber} · {strings.practitioners.providerTypes[entry.providerType] ?? entry.providerType}
            {entry.profession ? ` · ${entry.profession}` : ''}
          </p>

          {deregistered && <p className={styles.cardNote}>{strings.practitioners.deregisteredNote}</p>}

          {!deregistered && !entry.registerChecked && (
            <p className={styles.cardNote}>{strings.practitioners.registerNotCheckedNote}</p>
          )}

          {entry.registerChecked && (
            <p className={styles.cardNote}>
              {entry.registrationSource === 'pie_api'
                ? strings.practitioners.sourceApi
                : strings.practitioners.checkedBy
                    .replace('{who}', entry.registrationSightedByName ?? '—')
                    .replace('{when}', displayDate(entry.registrationSightedAt))}
            </p>
          )}

          {/* Conditions are the thing most easily skimmed past: somebody can be
              fully registered and still restricted in what they may do. */}
          {entry.conditions && entry.conditions.toLowerCase() !== 'none' && (
            <Notice tone="warn" title={strings.practitioners.checkConditions}>
              {entry.conditions}
            </Notice>
          )}

          {entry.affiliationCount === 0 ? (
            <p className={styles.cardNote}>{strings.practitioners.notAffiliatedNote}</p>
          ) : (
            <p className={styles.cardNote}>
              {strings.practitioners.affiliationSummary
                .replace('{active}', String(entry.activeAffiliationCount))
                .replace('{invited}', String(entry.invitedAffiliationCount))}
            </p>
          )}

          {/*
            Where an invitation would go. A practice that added this person
            sees the address it typed; one that did not is told an address
            exists and why it does not get to see it (domain/directory.ts).
          */}
          {entry.hasEmail ? (
            entry.invitedByThisPractice ? (
              <p className={styles.cardNote}>{entry.email}</p>
            ) : (
              <p className={styles.cardNote}>{strings.practitioners.emailWithheld}</p>
            )
          ) : (
            <p className={styles.cardNote}>{strings.practitioners.noEmail}</p>
          )}
        </div>

        <div className={styles.cardAside}>
          {deregistered ? (
            <Chip tone="stop" solid>
              <ShieldAlert size={13} aria-hidden="true" />
              {strings.practitioners.deregistered}
            </Chip>
          ) : entry.registerChecked ? (
            <Chip tone="ok">
              <CheckCircle2 size={13} aria-hidden="true" />
              {strings.practitioners.registerChecked}
            </Chip>
          ) : (
            <Chip tone="warn">
              <AlertTriangle size={13} aria-hidden="true" />
              {strings.practitioners.registerNotChecked}
            </Chip>
          )}
          {entry.registrationStatus && <Chip tone="neutral">{entry.registrationStatus}</Chip>}
          {entry.affiliationCount === 0 && (
            <Chip tone="warn">{strings.practitioners.notAffiliated}</Chip>
          )}
        </div>
      </div>

      {/*
        A deregistered practitioner gets no actions. There is nothing useful to
        do to them here and offering a button would imply otherwise.
      */}
      {!deregistered && (
        <div className={styles.cardActions}>
          {recording ? (
            <RegisterCheck
              entry={entry}
              headers={headers}
              onDone={async () => {
                setRecording(false);
                await onChanged();
              }}
              onCancel={() => setRecording(false)}
            />
          ) : (
            <>
              <Button
                variant={entry.registerChecked ? 'default' : 'primary'}
                onClick={() => setRecording(true)}
                data-testid={`check-${entry.practitionerId}`}
              >
                {strings.practitioners.checkOpen}
              </Button>
              <Link href="/practice/affiliations" className={ui.buttonLink}>
                {strings.practitioners.invite}
              </Link>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Recording what the register said
// ---------------------------------------------------------------------------

interface CheckResult {
  permitted: boolean;
  refusal: string | null;
  warnings: Array<{ code: string; message: string }>;
}

function RegisterCheck({
  entry,
  headers,
  onDone,
  onCancel,
}: {
  entry: RosterEntry;
  headers: Record<string, string>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState('Registered');
  const [profession, setProfession] = useState(entry.profession ?? '');
  const [division, setDivision] = useState('');
  const [conditions, setConditions] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [regType, setRegType] = useState<string>('General');
  const [specialty, setSpecialty] = useState('');
  const [expiry, setExpiry] = useState('');
  const [sightedBy, setSightedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  // A sighting has to be attributable to a person — that is the difference
  // between evidence and an assertion, and the server refuses it too.
  const ready = status.length > 0 && sightedBy.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioners/${entry.practitionerId}/registration`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          registrationStatus: status,
          profession: profession.trim() || undefined,
          division: division.trim() || undefined,
          conditions: conditions.trim() || undefined,
          principalSuburb: suburb.trim() || undefined,
          principalState: state || undefined,
          principalPostcode: postcode.trim() || undefined,
          source: 'ahpra_manual',
          sightedByName: sightedBy.trim(),
          registrationTypes: [
            {
              registrationType: regType,
              specialty: specialty.trim() || undefined,
              expiryDate: expiry ? new Date(expiry).toISOString() : undefined,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const body = (await res.json()) as CheckResult;
      setResult(body);
      /*
       * The result is shown BEFORE the list refreshes, and the panel stays
       * open. A status that forbids practice has just ended every affiliation
       * this person holds — that is a large consequence, and closing the form
       * on success would hide the one screen that explains it.
       */
      if (body.permitted && body.warnings.length === 0) await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <p className={styles.subHeading}>{strings.practitioners.checkTitle}</p>
      <p className={styles.cardNote}>{strings.practitioners.checkLead}</p>
      <p>
        <a href={AHPRA_REGISTER} target="_blank" rel="noreferrer noopener" className={ui.buttonLink}>
          {strings.practitioners.checkRegisterLink}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </p>

      <div className={styles.addGrid}>
        <Field label={strings.practitioners.checkStatus} hint={strings.practitioners.checkStatusHint} required>
          {(props) => (
            <SelectInput
              {...props}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              data-testid={`check-status-${entry.practitionerId}`}
            >
              {AHPRA_REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.practitioners.checkProfession} hint={strings.practitioners.checkProfessionHint}>
          {(props) => (
            <TextInput {...props} value={profession} onChange={(e) => setProfession(e.target.value)} />
          )}
        </Field>

        <Field label={strings.practitioners.checkDivision}>
          {(props) => <TextInput {...props} value={division} onChange={(e) => setDivision(e.target.value)} />}
        </Field>

        <Field label={strings.practitioners.checkType}>
          {(props) => (
            <SelectInput {...props} value={regType} onChange={(e) => setRegType(e.target.value)}>
              {REGISTRATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.practitioners.checkSpecialty} hint={strings.practitioners.checkSpecialtyHint}>
          {(props) => <TextInput {...props} value={specialty} onChange={(e) => setSpecialty(e.target.value)} />}
        </Field>

        <Field label={strings.practitioners.checkExpiry} hint={strings.practitioners.checkExpiryHint}>
          {(props) => (
            <TextInput {...props} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          )}
        </Field>

        <Field label={strings.practitioners.checkSuburb} hint={strings.practitioners.checkSuburbHint}>
          {(props) => <TextInput {...props} value={suburb} onChange={(e) => setSuburb(e.target.value)} />}
        </Field>

        <Field label={strings.practitioners.checkState}>
          {(props) => (
            <SelectInput {...props} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">—</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.practitioners.checkPostcode}>
          {(props) => (
            <TextInput
              {...props}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              inputMode="numeric"
              maxLength={4}
            />
          )}
        </Field>

        <Field label={strings.practitioners.checkConditions} hint={strings.practitioners.checkConditionsHint}>
          {(props) => (
            <TextInput {...props} value={conditions} onChange={(e) => setConditions(e.target.value)} />
          )}
        </Field>

        <Field
          label={strings.practitioners.checkSightedBy}
          hint={strings.practitioners.checkSightedByHint}
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={sightedBy}
              onChange={(e) => setSightedBy(e.target.value)}
              data-testid={`check-by-${entry.practitionerId}`}
            />
          )}
        </Field>
      </div>

      <div className={styles.formActions}>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid={`check-submit-${entry.practitionerId}`}
        >
          {busy ? strings.practitioners.checking : strings.practitioners.checkAction}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          {strings.practitioners.checkCancel}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.practitioners.checkFailed}>
          {error}
        </Notice>
      )}

      {result && !result.permitted && (
        <Notice tone="stop" title={strings.practitioners.checkRefused}>
          {result.refusal}
        </Notice>
      )}

      {/*
        Warnings are shown and NOT acted on. A past expiry in particular must
        never refuse: AHPRA allows a late period during which the practitioner
        may still practise, so refusing would stop a working doctor on the
        strength of a date.
      */}
      {result && result.warnings.length > 0 && (
        <Notice tone="warn" title={strings.practitioners.checkDone}>
          {result.warnings.map((w) => w.message).join(' ')}
        </Notice>
      )}

      {result && (
        <div className={styles.formActions}>
          <Button onClick={() => void onDone()}>{strings.practitioners.checkCancel}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding one
// ---------------------------------------------------------------------------

function AddPractitioner({
  headers,
  onAdded,
  added,
}: {
  headers: Record<string, string>;
  onAdded: () => void;
  added: boolean;
}) {
  const [ahpra, setAhpra] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [givenNames, setGivenNames] = useState('');
  const [providerType, setProviderType] = useState<string>('general_practitioner');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The AHPRA number is format-checked HERE as well as on the server, and the
   * message is the same one the domain raises. Catching a typo at the keyboard
   * saves a round trip; catching it only at the keyboard would mean the rule
   * lived in a form, which is where rules go to be forgotten.
   */
  const ahpraOk = isValidAhpraNumberFormat(ahpra.trim().toUpperCase());
  const ready = ahpraOk && familyName.trim().length > 0 && givenNames.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioners`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ahpraNumber: ahpra.trim().toUpperCase(),
          familyName: familyName.trim(),
          givenNames: givenNames.trim(),
          providerType,
          email: email.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setAhpra('');
      setFamilyName('');
      setGivenNames('');
      setEmail('');
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.addPanel}>
      <h2 className={ui.sectionTitle}>{strings.practitioners.addTitle}</h2>
      <p className={ui.hint}>{strings.practitioners.addLead}</p>

      <div className={styles.addGrid}>
        <Field
          label={strings.practitioners.addAhpra}
          hint={strings.practitioners.addAhpraHint}
          error={ahpra.trim().length > 0 && !ahpraOk ? strings.practitioners.addAhpraHint : null}
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={ahpra}
              onChange={(e) => setAhpra(e.target.value)}
              placeholder="MED0001234567"
              data-testid="prac-ahpra"
            />
          )}
        </Field>

        <Field label={strings.practitioners.addFamilyName} required>
          {(props) => (
            <TextInput
              {...props}
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              autoComplete="family-name"
              data-testid="prac-family"
            />
          )}
        </Field>

        <Field label={strings.practitioners.addGivenNames} required>
          {(props) => (
            <TextInput
              {...props}
              value={givenNames}
              onChange={(e) => setGivenNames(e.target.value)}
              autoComplete="given-name"
              data-testid="prac-given"
            />
          )}
        </Field>

        <Field label={strings.practitioners.addProviderType} hint={strings.practitioners.addProviderTypeHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={providerType}
              onChange={(e) => setProviderType(e.target.value)}
              data-testid="prac-type"
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {strings.practitioners.providerTypes[t]}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.practitioners.addEmail} hint={strings.practitioners.addEmailHint}>
          {(props) => (
            <TextInput
              {...props}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="prac-email"
            />
          )}
        </Field>
      </div>

      <div className={styles.formActions}>
        <Button variant="primary" onClick={() => void submit()} disabled={!ready || busy} data-testid="prac-add">
          <UserPlus size={14} aria-hidden="true" />
          {busy ? strings.practitioners.adding : strings.practitioners.addAction}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.practitioners.addFailed}>
          {error}
        </Notice>
      )}

      {added && !error && (
        <Notice tone="ok" title={strings.practitioners.addedTitle}>
          {strings.practitioners.addedBody}
        </Notice>
      )}
    </div>
  );
}
