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
import { AHPRA_REGISTRATION_STATUSES, EXTERNAL_LINKS, isValidAhpraNumberFormat, isPlatformOperator } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';
import { currentSession, apiHeaders } from '../../auth';
import { HistoryDisclosure } from '../../HistoryDisclosure';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Where a person goes to do the check this page records. */
/*
 * FROM THE SHARED FILE, not typed here. There were three spellings of this
 * destination across two apps and the reviewer checklist, and two of them had
 * drifted. When AHPRA moves the register the fix should be one line, changed by
 * whoever noticed.
 */
const AHPRA_REGISTER = EXTERNAL_LINKS.ahpraRegister.url;

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

/**
 * WHOSE WORK IS BEING DONE ON THIS PAGE — and there are two answers, which is
 * the thing acting-as alone could not express.
 *
 * 'practice'  the practice's own roster: adding a practitioner, inviting one,
 *             correcting a detail. An operator does this by ACTING AS them,
 *             which is recorded, announced, and forces a reapproval.
 *
 * 'platform'  OUR work about their practitioners: recording what the AHPRA
 *             public register says. That is an independent attestation and it
 *             must NOT be done while acting as the practice — a check recorded
 *             under the practice's name is a self-attestation wearing the name
 *             of an independent one, and in the audit trail it reads exactly
 *             like a real one. Acting-as would also force the practice to be
 *             reapproved because we did our own job, which is nonsense.
 *
 * The server has always known this: `recordRegistration` is PLATFORM_ADMIN and
 * takes no practice scope. Only the browser was missing the door.
 */
export type PractitionersMode = 'practice' | 'platform';

export function PractitionersView({
  practiceId,
  mode = 'practice',
}: {
  practiceId: string;
  mode?: PractitionersMode;
}) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const headers = apiHeaders(practiceId);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practitioners`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setRoster(await res.json());
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * REGISTERED WITH THE TOP-BAR REFRESH. The token is held in memory only, so
   * a browser reload throws the session away and asks for a passkey again --
   * this is the way to re-read without paying that.
   */
  useRefreshable(load);

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

      {mode === 'platform' && (
        /*
          SAYING WHICH HAT. Somebody who arrived here from the organisation list
          and somebody who arrived by acting as the practice see the same
          roster, and the difference in what they may do is invisible without
          this. A page whose rules you cannot see is a page you will be
          surprised by.
        */
        <Notice tone="warn" title={strings.practitioners.platformModeTitle}>
          {strings.practitioners.platformModeBody}
        </Notice>
      )}

      {/*
        THE PRACTICE'S OWN CONTROL, and only theirs. Adding a practitioner is
        the practice's act -- an operator does it by acting as them, which is
        recorded and announced. In platform mode the roster is here to be
        CHECKED, not added to.
      */}


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
          <PractitionerCard key={p.practitionerId} entry={p} headers={headers} onChanged={load} mode={mode} />
        ))}
      </ul>

      {mode === 'practice' && (
        <AddPractitioner
          headers={headers}
          added={added}
          onAdded={() => {
            setAdded(true);
            void load();
          }}
        />
      )}
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
  mode,
}: {
  entry: RosterEntry;
  headers: Record<string, string>;
  onChanged: () => Promise<void>;
  mode: PractitionersMode;
}) {
  const [recording, setRecording] = useState(false);

  /*
   * WHO MAY RECORD A REGISTER CHECK. A practice may not verify its own
   * evidence — the same rule that stops it confirming its own address. The
   * server enforces it (@RequireRoles(PLATFORM_ADMIN)); this only decides
   * whether to show a button or an explanation, because a button that always
   * fails is worse than no button.
   */
  const canCheck = isPlatformOperator({ roles: currentSession()?.roles ?? [] });

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

          {/*
            EVERY CHECK, NOT JUST THE LATEST — and beside the latest, because
            that is the fact somebody is looking at when the question occurs to
            them.

            The line above is a CACHE of the newest check. Until this existed
            each new check overwrote the last, so a practitioner Registered in
            March and Cancelled in August had one answer, and the March reading
            — the one that explains why a capture in April was allowed — was
            destroyed by the act of checking again.

            PLATFORM ONLY. This is our record of our own attestations; a
            practice that could read who checked and how often could work out
            how closely it is being watched. What the practice needs, whether
            the check is done and what it says now, is the line above.
          */}
          {canCheck && (
            <HistoryDisclosure
              url={`${CORE_URL}/practitioners/${entry.practitionerId}/registration/history`}
              extract={(body) => ((body as { checks?: RegisterCheck[] }).checks ?? [])}
              emptyMessage={strings.practitioners.historyEmpty}
              label={strings.practitioners.historyShow}
              testId={`register-history-${entry.practitionerId}`}
              renderRow={(c: RegisterCheck) => (
                <>
                  <strong>{c.registrationStatus}</strong>
                  {c.profession ? ` · ${c.profession}` : ''}
                  <span className={ui.hint}>
                    {' '}
                    · {displayDate(c.sightedAt)} ·{' '}
                    {c.source === 'pie_api'
                      ? strings.practitioners.sourceApi
                      : (c.sightedByName ?? strings.practitioners.historyNobody)}
                  </span>
                  {c.conditions && c.conditions.toLowerCase() !== 'none' && (
                    <span className={ui.hint}> · {c.conditions}</span>
                  )}
                </>
              )}
            />
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
      {/* A practice may not verify its own evidence. See below. */}
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
              {/*
                THE PRACTICE DOES NOT CHECK ITS OWN PRACTITIONER.

                Same rule as the address, and for the same reason: a register
                check is EVIDENCE THAT SOMEBODY INDEPENDENT LOOKED. It feeds
                the strength score that decides whether consent may be
                captured in this person’s name, so a practice recording its
                own practitioner as "Registered" would be awarding itself the
                check — and in the audit trail that reads identically to a
                real one.

                The practice still adds the person and still enters the AHPRA
                number. Entering scores nothing; only the recorded check does.
                The server refuses either way.
              */}
              {canCheck ? (
                <Button
                  variant={entry.registerChecked ? 'default' : 'primary'}
                  onClick={() => setRecording(true)}
                  data-testid={`check-${entry.practitionerId}`}
                >
                  {strings.practitioners.checkOpen}
                </Button>
              ) : (
                !entry.registerChecked && (
                  <Notice tone="warn" title={strings.practitioners.checkedByUsTitle}>
                    {strings.practitioners.checkedByUsBody}
                  </Notice>
                )
              )}
              {/*
                INVITING IS THE PRACTICE'S ACT, so it appears only when this
                page is being used as the practice.
                
                An operator here as the platform has no practice claim, so the
                affiliations page would refuse them anyway -- offering the link
                would spend their attention and then take it back. If they mean
                to invite somebody, they mean to act as the practice, and the
                banner above says where to start that.
              */}
              {mode === 'practice' && (
                <Link href="/practice/affiliations" className={ui.buttonLink}>
                  {strings.practitioners.invite}
                </Link>
              )}
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
  /*
   * WHO LOOKED comes from the session, not from a field.
   *
   * This is evidence that a person read the AHPRA register, and evidence
   * needs an author — but an author who types their own name is asserting
   * an identity we already hold, and the answer is worth whatever they
   * typed. The server overwrites it from the verified token regardless
   * (AttributionInterceptor), so the field was asking for something that
   * could not affect the record.
   */
  const sightedBy = currentSession()?.username ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  // A sighting has to be attributable to a person — that is the difference
  // between evidence and an assertion, and the server refuses it too.
  const ready = status.length > 0;

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

type RegisterCheck = {
  id: string;
  registrationStatus: string;
  profession: string | null;
  division: string | null;
  conditions: string | null;
  source: string;
  sightedByName: string | null;
  sightedAt: string;
};

type DirectoryHit = {
  practitionerId: string;
  familyName: string;
  givenNames: string;
  ahpraNumber: string;
  providerType: string;
  verified: boolean;
  registrationStatus: string | null;
  deregistered: boolean;
};

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
  const [existing, setExisting] = useState<DirectoryHit | null>(null);
  const [looking, setLooking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  /*
   * The AHPRA number is format-checked HERE as well as on the server, and the
   * message is the same one the domain raises. Catching a typo at the keyboard
   * saves a round trip; catching it only at the keyboard would mean the rule
   * lived in a form, which is where rules go to be forgotten.
   */
  const ahpraOk = isValidAhpraNumberFormat(ahpra.trim().toUpperCase());

  /*
   * ASKED AS SOON AS THE NUMBER IS WELL-FORMED, not on submit.
   *
   * An AHPRA number is unique across the platform, so the moment it is typed we
   * already know whether there is anything to create. Waiting until submit
   * meant somebody filled in a name, a profession and an email, pressed the
   * button, and was told the record existed all along — work thrown away for a
   * fact we had before they started.
   *
   * The lookup is AHPRA-number-only by design (domain/directory.ts): a name
   * search would let any practice enumerate every practitioner here. What comes
   * back is public-register data about one person somebody already named, which
   * is why it is safe to show to a practice that does not employ them yet.
   */
  useEffect(() => {
    const number = ahpra.trim().toUpperCase();
    if (!isValidAhpraNumberFormat(number)) {
      setExisting(null);
      setDismissed(false);
      return;
    }

    let live = true;
    setLooking(true);
    // A short pause, so typing a number does not fire a request per keystroke.
    const timer = setTimeout(() => {
      fetch(`${CORE_URL}/practitioners/directory?ahpraNumber=${encodeURIComponent(number)}`, { headers })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b: { found?: boolean; practitioner?: DirectoryHit }) => {
          if (!live) return;
          setExisting(b.found && b.practitioner ? b.practitioner : null);
        })
        // Silent. Not being able to check is not a reason to block somebody
        // from adding a practitioner; the server refuses a duplicate anyway.
        .catch(() => live && setExisting(null))
        .finally(() => live && setLooking(false));
    }, 350);

    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `headers` is deliberately not a dependency: its caller rebuilds the object
    // on every render, so including it would re-run this on every keystroke and
    // defeat the debounce. The practice scope inside it does not change while
    // this form is open.
  }, [ahpra]);

  const showExisting = Boolean(existing) && !dismissed;
  const ready = ahpraOk && !showExisting && familyName.trim().length > 0 && givenNames.trim().length > 0;

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

      {looking && !existing && ahpraOk && <p className={ui.hint}>{strings.practitioners.lookingUp}</p>}

      {/*
        ALREADY HERE. The refusal this replaces was accurate and useless: it
        told a practice that had typed the one identifier which settles who
        somebody is to go somewhere else and do something different.

        What it shows is deliberately thin — name, AHPRA number, profession,
        registration. Not their email, not their provider numbers, not where
        else they work. A practice confirming an identity needs to recognise a
        person; it does not need a file on them, and this platform must never
        become a directory of who works where.
      */}
      {showExisting && existing && (
        <div className={styles.addPanel} data-testid="practitioner-exists">
          <Notice tone="warn" title={strings.practitioners.existsTitle}>
            {strings.practitioners.existsBody}
          </Notice>

          <h3 className={ui.sectionTitle}>{strings.practitioners.existsCheck}</h3>
          <p className={styles.cardNote}>
            <strong>
              {existing.familyName}, {existing.givenNames}
            </strong>
          </p>
          <p className={ui.hint}>
            {strings.practitioners.existsAhpra}: {existing.ahpraNumber} · {strings.practitioners.existsType}:{' '}
            {strings.practitioners.providerTypes[existing.providerType] ?? existing.providerType}
          </p>
          <p className={ui.hint}>
            {strings.practitioners.existsStatus}:{' '}
            {existing.registrationStatus ?? strings.practitioners.existsStatusUnknown} ·{' '}
            {existing.verified ? strings.practitioners.existsVerified : strings.practitioners.existsUnverified}
          </p>

          {/*
            THE REGISTER, next to the details rather than elsewhere on the page.
            The practice is being asked to confirm an identity and AHPRA is the
            only authority on it, so the way to check has to be within reach of
            the thing being checked.
          */}
          <p>
            <a
              href={AHPRA_REGISTER}
              target="_blank"
              rel="noreferrer noopener"
              className={ui.buttonLink}
              data-testid="exists-ahpra-link"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {strings.practitioners.existsOnRegister}
            </a>
          </p>
          <p className={ui.hint}>
            {strings.practitioners.existsOnRegisterHint.replace('{ahpra}', existing.ahpraNumber)}
          </p>

          {existing.deregistered && (
            <Notice tone="stop" title={strings.practitioners.existsDeregisteredTitle}>
              {strings.practitioners.existsDeregisteredBody}
            </Notice>
          )}

          <div className={styles.formActions}>
            <Link href="/practice/affiliations" className={ui.buttonLink} data-testid="exists-invite">
              {strings.practitioners.existsInvite}
            </Link>
            {/*
              A WAY OUT, because a mistyped digit is a real AHPRA number
              belonging to somebody else. Without this the form would insist
              they had meant a stranger.
            */}
            <Button variant="subtle" onClick={() => setDismissed(true)} data-testid="exists-not-them">
              {strings.practitioners.existsNotThem}
            </Button>
          </div>
        </div>
      )}

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

        {/*
          LOCKED once the practitioner exists. A practice that could rename an
          existing practitioner could point a confirmed identity at a different
          person -- and any register check already recorded would go on
          attesting to a name that had changed underneath it.
        */}
        <Field
          label={strings.practitioners.addFamilyName}
          hint={showExisting ? strings.practitioners.existsNameLocked : undefined}
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={showExisting && existing ? existing.familyName : familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              disabled={showExisting}
              autoComplete="family-name"
              data-testid="prac-family"
            />
          )}
        </Field>

        <Field label={strings.practitioners.addGivenNames} required>
          {(props) => (
            <TextInput
              {...props}
              value={showExisting && existing ? existing.givenNames : givenNames}
              onChange={(e) => setGivenNames(e.target.value)}
              disabled={showExisting}
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
