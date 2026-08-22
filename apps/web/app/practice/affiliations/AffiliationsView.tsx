'use client';

/**
 * Affiliations — the edge between a practitioner and a place.
 *
 * THE DISTINCTION THIS PAGE EXISTS TO KEEP VISIBLE: invited is not accepted. A
 * practice reading "four practitioners" will take that to mean four
 * practitioners whose patients can be recorded as consenting, and it does not.
 * An invitation nobody has answered is worth nothing at all.
 *
 * AND "INVITED" ITSELF COVERS TWO STATES that must not look alike:
 *
 *   - we have emailed the practitioner and are waiting on them, or
 *   - nobody has told them anything, and it is entirely the practice's move.
 *
 * The second is the one that silently stalls an onboarding for a fortnight,
 * because from the practice's side it reads as "done, waiting on the doctor".
 * So a row with no invitation sent is promoted above one that is genuinely
 * waiting, and says whose move it is.
 *
 * THE PROVIDER NUMBER IS SHOWN HERE AND NOWHERE ELSE. It is the practice's own
 * number for its own practitioner at its own site; it never crosses to another
 * practice, and it is not on the practitioner's own invitation page either.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Send,
  UserSquare,
  XCircle,
} from 'lucide-react';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui, type Tone } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Affiliation {
  id: string;
  status: string;
  practitioner: { practitionerId: string; familyName: string; givenNames: string; ahpraNumber: string };
  location: { id: string; address: string; code: string | null };
  department: string | null;
  providerNumber: string | null;
  startedAt: string | null;
  noticeGivenAt: string | null;
  endsAt: string | null;
  canCapture: boolean;
  blockReason: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  acceptanceMethod: string | null;
  acceptanceMeans: string | null;
}

interface Location {
  id: string;
  code: string | null;
  address: string;
  active: boolean;
}

interface RosterEntry {
  practitionerId: string;
  familyName: string;
  givenNames: string;
  ahpraNumber: string;
  deregisteredAt: string | null;
}

interface Department {
  id: string;
  locationId: string;
  name: string;
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
 * Worst first, and "worst" means "furthest from being useful, soonest fixable".
 *
 * An invitation nobody has sent sits at the top because it is the practice's
 * own move and the likeliest thing to have been forgotten. Ended and declined
 * sink to the bottom: they are history, not work.
 */
function rank(a: Affiliation): number {
  if (a.status === 'invited') return a.invitationSentAt ? 1 : 0;
  if (a.status === 'ending') return 2;
  if (a.status === 'active') return a.canCapture ? 4 : 3;
  return 5;
}

export function AffiliationsView({ practiceId }: { practiceId: string }) {
  const [affiliations, setAffiliations] = useState<Affiliation[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);

  const headers = apiHeaders(practiceId);

  const load = useCallback(async () => {
    const scope = apiHeaders(practiceId);
    try {
      const [affRes, locRes, rosRes, depRes] = await Promise.all([
        fetch(`${CORE_URL}/affiliations`, { headers: scope }),
        fetch(`${CORE_URL}/organisations/locations`, { headers: scope }),
        fetch(`${CORE_URL}/practitioners`, { headers: scope }),
        fetch(`${CORE_URL}/organisations/departments`, { headers: scope }),
      ]);
      if (!affRes.ok) throw new Error(await refusalMessage(affRes));
      setAffiliations(await affRes.json());
      // The other three feed the invite form. None of them is worth failing the
      // page for: the affiliations are the subject, and a form that cannot be
      // filled in says so on its own.
      setLocations(locRes.ok ? await locRes.json() : []);
      setRoster(rosRes.ok ? await rosRes.json() : []);
      setDepartments(depRes.ok ? await depRes.json() : []);
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
        <Notice tone="stop" title={strings.affiliations.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  const ordered = affiliations ? [...affiliations].sort((a, b) => rank(a) - rank(b)) : [];
  const capturing = ordered.filter((a) => a.canCapture).length;
  const waiting = ordered.filter((a) => a.status === 'invited').length;

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={styles.crumb} data-testid="affiliations-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.affiliations.backToSetup}
      </Link>

      <h1 className={ui.pageTitle}>{strings.affiliations.title}</h1>
      <p className={ui.pageLead}>{strings.affiliations.lead}</p>

      {affiliations === null && <p className={ui.hint}>{strings.affiliations.loading}</p>}

      {affiliations !== null && affiliations.length > 0 && (
        <p className={styles.tally}>
          <span>
            {affiliations.length === 1
              ? strings.affiliations.countOne
              : strings.affiliations.countMany.replace('{n}', String(affiliations.length))}
          </span>
          {capturing > 0 && (
            <Chip tone="ok">{strings.affiliations.captureOpen.replace('{n}', String(capturing))}</Chip>
          )}
          {waiting > 0 && (
            <Chip tone="warn">{strings.affiliations.awaiting.replace('{n}', String(waiting))}</Chip>
          )}
        </p>
      )}

      {affiliations !== null && affiliations.length === 0 && (
        <div className={styles.empty}>
          <UserSquare size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.affiliations.emptyTitle}</p>
          <p className={ui.hint}>{strings.affiliations.emptyBody}</p>
        </div>
      )}

      <ul className={styles.list}>
        {ordered.map((a) => (
          <AffiliationCard key={a.id} affiliation={a} headers={headers} onChanged={load} />
        ))}
      </ul>

      <InviteForm
        headers={headers}
        locations={locations}
        roster={roster}
        departments={departments}
        invited={invited}
        onInvited={() => {
          setInvited(true);
          void load();
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// One affiliation
// ---------------------------------------------------------------------------

function statusChip(a: Affiliation): { tone: Tone; label: string; icon: React.ReactNode } {
  switch (a.status) {
    case 'invited':
      return a.invitationSentAt
        ? { tone: 'warn', label: strings.affiliations.statusInvited, icon: <Clock size={13} aria-hidden="true" /> }
        : {
            tone: 'warn',
            label: strings.affiliations.statusNotSent,
            icon: <AlertTriangle size={13} aria-hidden="true" />,
          };
    case 'active':
      return {
        tone: 'ok',
        label: strings.affiliations.statusActive,
        icon: <CheckCircle2 size={13} aria-hidden="true" />,
      };
    case 'ending':
      return { tone: 'warn', label: strings.affiliations.statusEnding, icon: <Clock size={13} aria-hidden="true" /> };
    case 'rejected':
      return {
        tone: 'stop',
        label: strings.affiliations.statusRejected,
        icon: <XCircle size={13} aria-hidden="true" />,
      };
    default:
      return { tone: 'neutral', label: strings.affiliations.statusEnded, icon: null };
  }
}

function AffiliationCard({
  affiliation,
  headers,
  onChanged,
}: {
  affiliation: Affiliation;
  headers: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [noticing, setNoticing] = useState(false);
  const [endsAt, setEndsAt] = useState('');
  const [givenBy, setGivenBy] = useState('');
  const [reason, setReason] = useState('');

  const a = affiliation;
  const chip = statusChip(a);
  const notSent = a.status === 'invited' && !a.invitationSentAt;

  const edge = notSent
    ? styles.cardNeedsWork
    : a.status === 'rejected'
      ? styles.cardStopped
      : a.canCapture
        ? styles.cardOk
        : styles.cardNeedsWork;

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}${path}`, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  }

  async function sendInvitation() {
    try {
      const result = await post(`/affiliations/${a.id}/invitation`);
      // The API reports "no email on record" as notified:false with a reason
      // rather than as an error, because it is not one. Surface the reason.
      setSent(result.notified ? strings.affiliations.sentTitle : String(result.detail ?? ''));
      if (!result.notified) setError(String(result.detail ?? ''));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function giveNotice() {
    try {
      await post(`/affiliations/${a.id}/notice`, {
        endsAt: new Date(endsAt).toISOString(),
        givenByName: givenBy.trim(),
        reason: reason.trim() || undefined,
      });
      setNoticing(false);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className={`${styles.card} ${edge}`} data-testid={`affiliation-${a.id}`}>
      <div className={styles.cardHead}>
        <UserSquare size={18} aria-hidden="true" className={styles.cardIcon} />
        <div className={styles.cardMain}>
          <p className={styles.cardTitle}>
            {a.practitioner.familyName}, {a.practitioner.givenNames}
          </p>
          <p className={styles.cardSub}>
            {a.location.code ? `${a.location.code} — ` : ''}
            {a.location.address}
            {a.department ? ` · ${a.department}` : ''}
          </p>

          {/* Whose move it is. The line this page exists for. */}
          {notSent && <p className={styles.cardNote}>{strings.affiliations.notSentNote}</p>}
          {a.status === 'invited' && a.invitationSentAt && (
            <p className={styles.cardNote}>
              {strings.affiliations.sentNote.replace('{when}', displayDate(a.invitationSentAt))}{' '}
              {a.invitationExpiresAt &&
                strings.affiliations.expiresNote.replace('{when}', displayDate(a.invitationExpiresAt))}
            </p>
          )}
          {a.status === 'active' && (
            <p className={styles.cardNote}>
              {strings.affiliations.acceptedNote.replace('{when}', displayDate(a.startedAt))}
            </p>
          )}
          {a.status === 'ending' && (
            <p className={styles.cardNote}>
              {strings.affiliations.endingNote.replace('{when}', displayDate(a.endsAt))}
            </p>
          )}
          {a.status === 'ended' && (
            <p className={styles.cardNote}>
              {strings.affiliations.endedNote.replace('{when}', displayDate(a.endsAt))}
            </p>
          )}
          {a.status === 'rejected' && <p className={styles.cardNote}>{strings.affiliations.rejectedNote}</p>}

          {/*
            HOW it was accepted, not merely that it was. An emailed code and a
            passkey assertion are different evidence, and a practice relying on
            one of them should be able to see which they have.
          */}
          {a.acceptanceMeans && (
            <p className={styles.cardNote}>
              <strong>{strings.affiliations.howAccepted}:</strong> {a.acceptanceMeans}
            </p>
          )}

          {/*
            Shown ONLY where it adds something: a row that says "accepted" and
            still cannot capture, which is the genuinely surprising case
            (deregistration, an unconfirmed location). On an ended or declined
            row the status note above already says it, and printing both made
            the card say the same sentence twice in slightly different words.
          */}
          {a.blockReason && !a.canCapture && (a.status === 'active' || a.status === 'ending') && (
            <p className={styles.cardNote}>{a.blockReason}</p>
          )}

          {a.providerNumber ? (
            <p className={styles.cardNote}>
              {strings.affiliations.providerNumber}: <code>{a.providerNumber}</code>
            </p>
          ) : (
            <p className={styles.cardNote}>{strings.affiliations.noProviderNumberNote}</p>
          )}
        </div>

        <div className={styles.cardAside}>
          <Chip tone={chip.tone}>
            {chip.icon}
            {chip.label}
          </Chip>
          {!a.providerNumber && <Chip tone="neutral">{strings.affiliations.noProviderNumber}</Chip>}
        </div>
      </div>

      <div className={styles.cardActions}>
        {a.status === 'invited' && (
          <>
            <Button
              variant={notSent ? 'primary' : 'default'}
              onClick={() => void sendInvitation()}
              disabled={busy}
              data-testid={`send-${a.id}`}
            >
              <Send size={14} aria-hidden="true" />
              {busy
                ? strings.affiliations.sending
                : notSent
                  ? strings.affiliations.send
                  : strings.affiliations.resend}
            </Button>
            {!notSent && <span className={ui.hint}>{strings.affiliations.resendNote}</span>}
          </>
        )}

        {(a.status === 'active' || a.status === 'ending') &&
          (noticing ? (
            <div style={{ width: '100%' }}>
              <p className={styles.cardNote}>{strings.affiliations.noticeLead}</p>
              <div className={styles.inlineForm}>
                <Field label={strings.affiliations.noticeDate} required>
                  {(props) => (
                    <TextInput
                      {...props}
                      type="date"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      data-testid={`notice-date-${a.id}`}
                    />
                  )}
                </Field>
                <Field label={strings.affiliations.noticeBy} required>
                  {(props) => (
                    <TextInput
                      {...props}
                      value={givenBy}
                      onChange={(e) => setGivenBy(e.target.value)}
                      data-testid={`notice-by-${a.id}`}
                    />
                  )}
                </Field>
                <Field label={strings.affiliations.noticeReason} hint={strings.affiliations.noticeReasonHint}>
                  {(props) => (
                    <TextInput {...props} value={reason} onChange={(e) => setReason(e.target.value)} />
                  )}
                </Field>
                <Button
                  variant="primary"
                  onClick={() => void giveNotice()}
                  disabled={busy || !endsAt || givenBy.trim().length === 0}
                  data-testid={`notice-submit-${a.id}`}
                >
                  {busy ? strings.affiliations.noticing : strings.affiliations.noticeAction}
                </Button>
                <Button variant="subtle" onClick={() => setNoticing(false)}>
                  {strings.affiliations.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button onClick={() => setNoticing(true)} data-testid={`notice-${a.id}`}>
                {strings.affiliations.notice}
              </Button>
              {a.status === 'ending' && (
                <Button
                  onClick={() =>
                    void post(`/affiliations/${a.id}/notice/withdraw`)
                      .then(onChanged)
                      .catch((e: Error) => setError(e.message))
                  }
                  disabled={busy}
                  data-testid={`withdraw-${a.id}`}
                >
                  {busy ? strings.affiliations.withdrawing : strings.affiliations.withdraw}
                </Button>
              )}
            </>
          ))}
      </div>

      {/* Beside the buttons that caused it, never at the top of the page. */}
      {error && (
        <div className={styles.cardActions}>
          <Notice tone="stop" title={strings.affiliations.sendFailed}>
            {error}
          </Notice>
        </div>
      )}
      {sent && !error && (
        <div className={styles.cardActions}>
          <Notice tone="ok" title={strings.affiliations.sentTitle}>
            {strings.affiliations.resendNote}
          </Notice>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

function InviteForm({
  headers,
  locations,
  roster,
  departments,
  invited,
  onInvited,
}: {
  headers: Record<string, string>;
  locations: Location[];
  roster: RosterEntry[];
  departments: Department[];
  invited: boolean;
  onInvited: () => void;
}) {
  const [ahpra, setAhpra] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [providerNumber, setProviderNumber] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only CONFIRMED locations. An unconfirmed address must not appear in a
  // s 65C(5)(a) particulars block, so it cannot host anybody — offering it here
  // would only produce a refusal one click later.
  const usable = locations.filter((l) => l.active);
  // A deregistered practitioner cannot be affiliated at all (REQ-XFER-08), so
  // they are not offered.
  const invitable = roster.filter((p) => !p.deregisteredAt);
  const forLocation = departments.filter((d) => d.locationId === locationId);

  const ready = ahpra.length > 0 && locationId.length > 0 && invitedBy.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/affiliations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ahpraNumber: ahpra,
          locationId,
          departmentId: departmentId || undefined,
          providerNumber: providerNumber.trim() || undefined,
          invitedByName: invitedBy.trim(),
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setAhpra('');
      setDepartmentId('');
      setProviderNumber('');
      onInvited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.addPanel}>
      <h2 className={ui.sectionTitle}>{strings.affiliations.inviteTitle}</h2>
      <p className={ui.hint}>{strings.affiliations.inviteLead}</p>

      {/*
        The two dead ends, each pointing at the page that fixes it. A form that
        cannot be completed and does not say why is the worst kind of empty
        state — it reads as broken rather than as unfinished.
      */}
      {usable.length === 0 && (
        <Notice tone="warn" title={strings.affiliations.inviteNoLocations}>
          <Link href="/practice/locations">{strings.affiliations.toLocations}</Link>
        </Notice>
      )}
      {invitable.length === 0 && (
        <Notice tone="warn" title={strings.affiliations.inviteNoPractitioners}>
          <Link href="/practice/practitioners">{strings.affiliations.toPractitioners}</Link>
        </Notice>
      )}

      <div className={styles.addGrid}>
        <Field
          label={strings.affiliations.invitePractitioner}
          hint={strings.affiliations.invitePractitionerHint}
          required
        >
          {(props) => (
            <SelectInput
              {...props}
              value={ahpra}
              onChange={(e) => setAhpra(e.target.value)}
              disabled={invitable.length === 0}
              data-testid="aff-practitioner"
            >
              <option value="">{strings.affiliations.invitePractitionerPick}</option>
              {invitable.map((p) => (
                <option key={p.practitionerId} value={p.ahpraNumber}>
                  {p.familyName}, {p.givenNames} — {p.ahpraNumber}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.affiliations.inviteLocation} hint={strings.affiliations.inviteLocationHint} required>
          {(props) => (
            <SelectInput
              {...props}
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                // A department belongs to ONE location, so a stale choice here
                // would send a department id that does not sit under the site
                // being chosen.
                setDepartmentId('');
              }}
              disabled={usable.length === 0}
              data-testid="aff-location"
            >
              <option value="">{strings.affiliations.inviteLocationPick}</option>
              {usable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code ? `${l.code} — ${l.address}` : l.address}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.affiliations.inviteDepartment}>
          {(props) => (
            <SelectInput
              {...props}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={forLocation.length === 0}
              data-testid="aff-department"
            >
              <option value="">{strings.affiliations.inviteDepartmentNone}</option>
              {forLocation.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field
          label={strings.affiliations.inviteProviderNumber}
          hint={strings.affiliations.inviteProviderNumberHint}
        >
          {(props) => (
            <TextInput
              {...props}
              value={providerNumber}
              onChange={(e) => setProviderNumber(e.target.value)}
              data-testid="aff-provider"
            />
          )}
        </Field>

        <Field label={strings.affiliations.inviteBy} hint={strings.affiliations.inviteByHint} required>
          {(props) => (
            <TextInput
              {...props}
              value={invitedBy}
              onChange={(e) => setInvitedBy(e.target.value)}
              data-testid="aff-by"
            />
          )}
        </Field>
      </div>

      <div className={styles.formActions}>
        <Button variant="primary" onClick={() => void submit()} disabled={!ready || busy} data-testid="aff-invite">
          {busy ? strings.affiliations.inviting : strings.affiliations.inviteAction}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.affiliations.inviteFailed}>
          {error}
        </Notice>
      )}

      {invited && !error && (
        <Notice tone="ok" title={strings.affiliations.invitedTitle}>
          {strings.affiliations.invitedBody}
        </Notice>
      )}
    </div>
  );
}
