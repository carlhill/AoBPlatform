'use client';

/**
 * The places a practice works from.
 *
 * WHY THIS PAGE IS NOT A CRUD TABLE. A location's address is what prints in the
 * s 65C(5)(a) particulars block of every agreement captured there. It is not a
 * contact detail — it is part of the legal record of who consented to what, at
 * which practice. So this page is built around one question, "has a human
 * confirmed this address", and it says out loud what turns on the answer.
 *
 * A LOCATION ARRIVES INACTIVE and cannot host a practitioner until confirmed.
 * That is deliberately obstructive: an unconfirmed address on a consent record
 * is a defect nobody notices until an audit, at which point every agreement
 * captured there is in question. Better a blocked location today.
 *
 * WORST FIRST. Unconfirmed locations sort above confirmed ones. The reader came
 * here to deal with what is not working; a list in creation order asks them to
 * hunt for it.
 *
 * DEPARTMENTS LIVE HERE, not on a page of their own. A department is a
 * subdivision OF a location — it has no meaning apart from one, nothing in the
 * legislation turns on it, and a separate page would imply a standing it does
 * not have.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, MapPin, Pencil, Plus } from 'lucide-react';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { isPlatformOperator } from '@aobplatform/domain';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import styles from '../manage.module.css';
import { AddressDecision, AddressEdit, useAddressCatalogue } from './AddressDecision';
import { SessionControl } from '../../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** The states and territories, for the public-holiday calendar (REQ-OFF-03). */
const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

interface Location {
  id: string;
  code: string | null;
  address: string;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  postcode: string | null;
  country: string | null;
  state: string | null;
  active: boolean;
  addressValidated: boolean;

  // How it was confirmed, and by whom. Absent on locations confirmed before
  // the catalogue existed — those rows keep a bare boolean and are not
  // retro-labelled with a method nobody chose.
  addressCheckMethod?: string | null;
  addressCheckedByName?: string | null;
  addressCheckArtefactId?: string | null;

  // Why it was sent back, if it was. The address itself is left exactly as
  // the practice entered it, so they can see what we looked at.
  addressRejectedAt?: string | null;
  addressRejectedReason?: string | null;
  addressRejectedDetail?: string | null;
  addressRejectedByName?: string | null;
}

interface Department {
  id: string;
  locationId: string;
  name: string;
  active: boolean;
}

interface AddResult {
  id: string;
  active: boolean;
  reason?: string | null;
  suggestions?: string[] | null;
  warnings?: string[] | null;
}

/** Nest's exception body, which is a string OR an array of them from a DTO. */
async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

export function LocationsView({ practiceId }: { practiceId: string }) {
  /*
   * Only a platform operator verifies an address. A practice admin sees the
   * state and is told who resolves it; the server refuses them regardless, so
   * this decides what is OFFERED rather than what is allowed.
   */
  const canConfirm = isPlatformOperator({ roles: currentSession()?.roles ?? [] });
  // Fetched once for the whole list rather than per card — every card
  // renders from the same catalogue, and one request is one request.
  const catalogue = useAddressCatalogue();

  const [locations, setLocations] = useState<Location[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** The just-added location's outcome, so the reader learns what happened to it. */
  const [addResult, setAddResult] = useState<AddResult | null>(null);

  const headers = apiHeaders(practiceId);

  const load = useCallback(async () => {
    try {
      const [locRes, deptRes] = await Promise.all([
        fetch(`${CORE_URL}/organisations/locations`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/organisations/departments`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!locRes.ok) throw new Error(String(locRes.status));
      setLocations(await locRes.json());
      // Departments failing is not worth failing the page for: the locations
      // are the subject, and a location with its departments missing is still
      // useful. It shows as "no departments", which is honest enough.
      setDepartments(deptRes.ok ? await deptRes.json() : []);
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
        <Notice tone="stop" title={strings.locations.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  // Unconfirmed first. Within each group, oldest first — the order they were
  // added is the order the reader thinks about them in.
  const ordered = locations ? [...locations].sort((a, b) => Number(a.active) - Number(b.active)) : [];
  const activeCount = ordered.filter((l) => l.active).length;
  const inactiveCount = ordered.length - activeCount;

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={styles.crumb} data-testid="locations-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.locations.backToSetup}
      </Link>

      <h1 className={ui.pageTitle}>{strings.locations.title}</h1>
      <p className={ui.pageLead}>{strings.locations.lead}</p>

      {locations === null && <p className={ui.hint}>{strings.locations.loading}</p>}

      {locations !== null && locations.length > 0 && (
        <p className={styles.tally}>
          <span>
            {locations.length === 1
              ? strings.locations.countOne
              : strings.locations.countMany.replace('{n}', String(locations.length))}
          </span>
          {activeCount > 0 && (
            <Chip tone="ok">{strings.locations.activeCount.replace('{n}', String(activeCount))}</Chip>
          )}
          {inactiveCount > 0 && (
            <Chip tone="warn">{strings.locations.inactiveCount.replace('{n}', String(inactiveCount))}</Chip>
          )}
        </p>
      )}

      {locations !== null && locations.length === 0 && (
        <div className={styles.empty}>
          <MapPin size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.locations.emptyTitle}</p>
          <p className={ui.hint}>{strings.locations.emptyBody}</p>
        </div>
      )}

      <ul className={styles.list}>
        {ordered.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            departments={departments.filter((d) => d.locationId === location.id)}
            headers={headers}
            canConfirm={canConfirm}
            catalogue={catalogue}
            onChanged={load}
          />
        ))}
      </ul>

      <AddLocation
        headers={headers}
        result={addResult}
        onAdded={(added) => {
          setAddResult(added);
          void load();
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// One location
// ---------------------------------------------------------------------------

function LocationCard({
  location,
  departments,
  headers,
  canConfirm,
  catalogue,
  onChanged,
}: {
  location: Location;
  departments: Department[];
  headers: Record<string, string>;
  /** Whether the viewer may verify the address. A practice may not verify its own. */
  canConfirm: boolean;
  /** The check-method and rejection-reason catalogue, from the server. */
  catalogue: ReturnType<typeof useAddressCatalogue>;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const [deptName, setDeptName] = useState('');
  const [deptBusy, setDeptBusy] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  /*
   * THE CONFIRM HANDLER USED TO LIVE HERE, and it posted a name the person had
   * typed about themselves. Both halves are gone: WHO comes from the verified
   * token now (SessionActor on the server), and HOW comes from the catalogue —
   * see AddressDecision. What is left here is only the open/close state.
   */

  async function addDepartment() {
    setDeptBusy(true);
    setDeptError(null);
    try {
      const res = await fetch(`${CORE_URL}/organisations/departments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ locationId: location.id, name: deptName.trim() }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setDeptName('');
      await onChanged();
    } catch (e) {
      setDeptError((e as Error).message);
    } finally {
      setDeptBusy(false);
    }
  }

  return (
    <li
      className={`${styles.card} ${location.active ? styles.cardOk : styles.cardNeedsWork}`}
      data-testid={`location-${location.id}`}
    >
      <div className={styles.cardHead}>
        <Building2 size={18} aria-hidden="true" className={styles.cardIcon} />
        <div className={styles.cardMain}>
          <p className={styles.cardTitle}>{location.code || location.address}</p>
          {location.code && <p className={styles.cardSub}>{location.address}</p>}
          <p className={styles.cardNote}>
            {location.active ? strings.locations.activeNote : strings.locations.inactiveNote}
          </p>
          {/*
            No state means the public-holiday calendar cannot be chosen, and
            termination notices are counted in business days. Said here rather
            than only when confirming fails, so it is fixable before it blocks.
          */}
          {!location.state && <p className={styles.cardNote}>{strings.locations.noState}</p>}
        </div>
        <div className={styles.cardAside}>
          {location.active ? (
            <Chip tone="ok">
              <CheckCircle2 size={13} aria-hidden="true" />
              {strings.locations.active}
            </Chip>
          ) : (
            <Chip tone="warn">
              <AlertTriangle size={13} aria-hidden="true" />
              {strings.locations.inactive}
            </Chip>
          )}
          {location.state && <Chip tone="neutral">{location.state}</Chip>}
        </div>
      </div>

      <div className={styles.cardBody}>
        <p className={styles.subHeading}>{strings.locations.departments}</p>
        {departments.length === 0 ? (
          <p className={styles.cardNote}>{strings.locations.departmentsNone}</p>
        ) : (
          <ul className={styles.subList}>
            {departments.map((d) => (
              <li key={d.id} className={styles.subItem}>
                {d.name}
              </li>
            ))}
          </ul>
        )}

        {location.active ? (
          <>
            <div className={styles.inlineForm}>
              <Field label={strings.locations.departmentName}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="Emergency"
                    data-testid={`dept-name-${location.id}`}
                  />
                )}
              </Field>
              <Button
                onClick={() => void addDepartment()}
                disabled={deptBusy || deptName.trim().length === 0}
                data-testid={`dept-add-${location.id}`}
              >
                <Plus size={14} aria-hidden="true" />
                {deptBusy ? strings.locations.departmentAdding : strings.locations.departmentAction}
              </Button>
            </div>
            {/*
              The error sits WITH the form that produced it. A refusal painted
              at the top of a long page is a refusal nobody sees — which is
              exactly how a save that silently did nothing got shipped once.
            */}
            {deptError && (
              <Notice tone="stop" title={strings.locations.departmentFailed}>
                {deptError}
              </Notice>
            )}
          </>
        ) : (
          <p className={styles.cardNote}>{strings.locations.departmentNeedsActive}</p>
        )}
      </div>

      {/*
        THE PRACTICE DOES NOT CONFIRM ITS OWN ADDRESS.
        
        The address prints in the s 65C(5)(a) particulars block of every
        agreement captured here, so confirming it is VERIFYING EVIDENCE — and
        the party supplying the evidence cannot be the party that verifies it.
        Same rule the credential score rests on: entering a thing scores
        nothing, and only an independent recorded check gives it weight.
        
        So a practice is told the state and who resolves it, and the form is
        shown only to somebody who may actually use it. The server refuses the
        rest either way.
      */}
      {/*
        THE PRACTICE DOES NOT CONFIRM ITS OWN ADDRESS, but it may CORRECT one.

        The address prints in the s 65C(5)(a) particulars block of every
        agreement captured here, so confirming it is VERIFYING EVIDENCE — and
        the party supplying the evidence cannot be the party that verifies it.
        Correcting a claim nobody has checked yet is a different act entirely,
        and it is ordinary work.
      */}
      {!location.active && !canConfirm && (
        <div className={styles.cardActions}>
          {/*
            WHY IT CAME BACK, if it did. Before this existed a reviewer could
            only ever say yes, so a practice whose address was wrong sat
            blocked with nothing to read and nothing to do.
          */}
          {location.addressRejectedAt ? (
            <Notice tone="warn" title={strings.locations.sentBackTitle}>
              <p>{rejectionGuidance(catalogue, location.addressRejectedReason)}</p>
              {location.addressRejectedDetail && (
                <p>
                  <strong>{strings.locations.sentBackDetail}</strong> {location.addressRejectedDetail}
                </p>
              )}
              {location.addressRejectedByName && (
                <p className={styles.cardNote}>
                  {strings.locations.sentBackBy} {location.addressRejectedByName}
                </p>
              )}
            </Notice>
          ) : (
            <Notice tone="warn" title={strings.locations.confirmedByUsTitle}>
              {strings.locations.confirmedByUsBody}
            </Notice>
          )}

          {editing ? (
            <AddressEdit
              location={location}
              headers={headers}
              onDone={async () => {
                setEditing(false);
                await onChanged();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Button variant="primary" onClick={() => setEditing(true)} data-testid={`edit-${location.id}`}>
              <Pencil size={15} aria-hidden="true" />
              {strings.locations.editTitle}
            </Button>
          )}
        </div>
      )}

      {!location.active && canConfirm && (
        <div className={styles.cardActions}>
          {location.addressRejectedAt && (
            <Notice tone="warn" title={strings.locations.sentBackTitle}>
              {rejectionGuidance(catalogue, location.addressRejectedReason)}
              {location.addressRejectedByName ? ` — ${location.addressRejectedByName}` : ''}
            </Notice>
          )}
          {confirming ? (
            <AddressDecision
              locationId={location.id}
              headers={headers}
              catalogue={catalogue}
              onDone={async () => {
                setConfirming(false);
                await onChanged();
              }}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <Button variant="primary" onClick={() => setConfirming(true)} data-testid={`confirm-${location.id}`}>
              {strings.locations.confirmTitle}
            </Button>
          )}
        </div>
      )}

      {/*
        HOW a confirmed address was checked. A confirmation that does not say
        what was done is not evidence anybody can weigh later.
      */}
      {location.active && location.addressCheckMethod && (
        <p className={styles.cardNote} data-testid={`checked-${location.id}`}>
          {strings.locations.confirmedVia}{' '}
          <strong>{methodLabel(catalogue, location.addressCheckMethod)}</strong>
          {location.addressCheckedByName ? ` — ${location.addressCheckedByName}` : ''}
          {location.addressCheckArtefactId ? ` · ${strings.locations.confirmedDocument}` : ''}
        </p>
      )}


    </li>
  );
}

// ---------------------------------------------------------------------------
// Adding one
// ---------------------------------------------------------------------------

function AddLocation({
  headers,
  onAdded,
  result,
}: {
  headers: Record<string, string>;
  onAdded: (result: AddResult) => void;
  result: AddResult | null;
}) {
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DEAD UNTIL VALID (ui/index.tsx). A location without a suburb and a state
  // cannot be matched against the address file or assigned a holiday calendar,
  // so the button does not pretend it could.
  const ready = line1.trim().length > 0 && suburb.trim().length > 0 && state.length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/organisations/locations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          addressLine1: line1.trim(),
          addressLine2: line2.trim() || undefined,
          suburb: suburb.trim(),
          state,
          postcode: postcode.trim() || undefined,
          code: code.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const added = (await res.json()) as AddResult;
      setLine1('');
      setLine2('');
      setSuburb('');
      setState('');
      setPostcode('');
      setCode('');
      onAdded(added);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.addPanel}>
      <h2 className={ui.sectionTitle}>{strings.locations.addTitle}</h2>
      <p className={ui.hint}>{strings.locations.addLead}</p>

      <div className={styles.addGrid}>
        <Field label={strings.locations.addressLine1} hint={strings.locations.addressLine1Hint} required>
          {(props) => (
            <TextInput
              {...props}
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              autoComplete="address-line1"
              data-testid="loc-line1"
            />
          )}
        </Field>

        <Field label={strings.locations.addressLine2} hint={strings.locations.addressLine2Hint}>
          {(props) => (
            <TextInput
              {...props}
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              autoComplete="address-line2"
              data-testid="loc-line2"
            />
          )}
        </Field>

        <Field label={strings.locations.suburb} required>
          {(props) => (
            <TextInput
              {...props}
              value={suburb}
              onChange={(e) => setSuburb(e.target.value)}
              autoComplete="address-level2"
              data-testid="loc-suburb"
            />
          )}
        </Field>

        <Field label={strings.locations.state} hint={strings.locations.stateHint} required>
          {(props) => (
            <SelectInput
              {...props}
              value={state}
              onChange={(e) => setState(e.target.value)}
              data-testid="loc-state"
            >
              <option value="">{strings.locations.statePick}</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.locations.postcode}>
          {(props) => (
            <TextInput
              {...props}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              inputMode="numeric"
              maxLength={4}
              autoComplete="postal-code"
              data-testid="loc-postcode"
            />
          )}
        </Field>

        <Field label={strings.locations.code} hint={strings.locations.codeHint}>
          {(props) => (
            <TextInput {...props} value={code} onChange={(e) => setCode(e.target.value)} data-testid="loc-code" />
          )}
        </Field>
      </div>

      <div className={styles.formActions}>
        <Button variant="primary" onClick={() => void submit()} disabled={!ready || busy} data-testid="loc-add">
          <Plus size={14} aria-hidden="true" />
          {busy ? strings.locations.adding : strings.locations.addAction}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.locations.addFailed}>
          {error}
        </Notice>
      )}

      {/*
        What happened to the one just added. An address that matched the national
        file is ready to use; one that did not is NOT an error and must not read
        as one — new developments and consulting suites are routinely missing.
      */}
      {result && !error && (
        <Notice
          tone={result.active ? 'ok' : 'warn'}
          title={result.active ? strings.locations.checkedTitle : strings.locations.unconfirmedTitle}
        >
          {result.active ? strings.locations.checkedBody : strings.locations.unconfirmedBody}
          {result.suggestions && result.suggestions.length > 0 && (
            <>
              <br />
              {strings.locations.suggestionsTitle}
              <ul className={styles.suggestions}>
                {result.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </Notice>
      )}
    </div>
  );
}

/**
 * The practice-facing wording for a rejection, from the server catalogue.
 *
 * Falls back to the raw key ONLY if the catalogue has not loaded. Showing
 * "not_a_clinical_site" to a practice would be worse than useless, so the
 * fallback is deliberately a generic sentence rather than the key.
 */
function rejectionGuidance(
  catalogue: ReturnType<typeof useAddressCatalogue>,
  reason?: string | null,
): string {
  const found = catalogue?.rejectionReasons.find((r) => r.key === reason);
  return found?.practiceGuidance ?? strings.locations.confirmedByUsBody;
}

/** The reviewer-facing label for a check method. */
function methodLabel(
  catalogue: ReturnType<typeof useAddressCatalogue>,
  method?: string | null,
): string {
  return catalogue?.methods.find((m) => m.key === method)?.label ?? method ?? '';
}
