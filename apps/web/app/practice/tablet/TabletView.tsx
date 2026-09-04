'use client';

/**
 * SEND TO THE TABLET — reception's half of the push (TODO.md "Two front
 * doors", Carl 4 Sep 2026).
 *
 * THE USE CASE, IN ONE SENTENCE. Reception has checked the Medicare card in
 * the PMS, matched the patient, and asked their date of birth, mobile, email
 * and address across the desk — the three-identifier staff check (REQ-VER-03).
 * They then send the visit's agreement to the tablet beside them. The patient
 * ticks their details as correct, reads, and approves. They never search for
 * themselves and they never type.
 *
 * TWO COLUMNS, BECAUSE THERE ARE TWO QUESTIONS. On the left, WHO IS WAITING
 * and can their agreement go. On the right, WHAT ARE MY TABLETS DOING. A
 * receptionist glances between them all morning, and putting either one behind
 * a tab would mean pressing something to find out whether the patient in front
 * of them has finished.
 *
 * A STATUS, NOT A MIRROR (TODO.md). The right-hand column says "Showing to
 * Jamie Sampleton — reading". It does not reproduce the tablet's screen: that
 * would put a patient's date of birth and address on a second monitor, at the
 * front counter, facing the room, for no gain — reception already knows those
 * details, having just asked for them.
 *
 * BLOCKED ROWS ARE SHOWN, NOT HIDDEN, and this is Carl's own live test made
 * structural. On the walk-up kiosk he chose a name, passed all three
 * identifiers, and only then met a hand-over screen that named nobody — the
 * patient's effort spent for nothing and reception with no way to tell who
 * needed fixing. A list that silently omitted the drafts that cannot be sent
 * would reproduce exactly that at the desk. So every row says whether it can
 * go and, if not, which rule is in the way and what to do about it.
 *
 * THE SERVER'S REASON, IN OUR WORDS. A refusal arrives as a CODE
 * (`service_description_missing`), never as a rules-engine sentence, and this
 * page renders its own string-table entry for it (REQ-LANG-01, hard rule 9's
 * reasoning applied to a staff surface). Nothing shown here is ever a message
 * with a patient's data folded into it.
 *
 * DEAD UNTIL VALID, everywhere (CLAUDE.md §6). Send is disabled on a row that
 * cannot go, with the reason beside it; the who-is-signing panel's Save is
 * disabled until the party passes the same domain guards the SERVER applies —
 * imported from `@aobplatform/domain`, never re-typed here, so the two cannot
 * drift apart.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04), and the page says so in
 * words. A patient who walks away from the tablet is still seen; reception
 * bills privately or asks again after the service.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ClipboardList, RotateCcw, Send, Tablet, UserRound } from 'lucide-react';
import {
  ASSIGNOR_RELATIONSHIPS_VERSION,
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  MIN_AGE_ASSIGN_FOR_OTHER,
  audiencesOf,
  authorityBasisFor,
  matchesPracticeStaff,
  mayReach,
  relationshipNeedsFreeText,
  type Audience,
  type DeviceRow,
  type PushBlockedReason,
  type TabletSessionRow,
} from '@aobplatform/domain';
import {
  Button,
  Checkbox,
  Chip,
  Field,
  Notice,
  Section,
  SelectInput,
  Shell,
  TextInput,
  ui,
  type Tone,
} from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import { SessionControl } from '../../SessionControl';
import styles from '../manage.module.css';
import rowStyles from './tablet.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * THREE SECONDS. The kiosk's own cadence is two while somebody is waiting
 * (`KIOSK_POLL_MS`), and reception is one hop behind the tablet rather than in
 * front of it — a receptionist watching a patient tick five boxes needs the
 * state within a breath, and three seconds is that without doubling the poll
 * traffic of a busy practice.
 */
const POLL_MS = 3000;

export interface PushableRow {
  agreementId: string;
  agreementType: string;
  status: string;
  patientName: string;
  providerName: string | null;
  providerType: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  serviceDescription: string | null;
  serviceDescriptionValid: boolean;
  assignorIsPatient: boolean;
  assignorName: string | null;
  assignorRelationship: string | null;
  particularsLocked: boolean;
  pushable: boolean;
  blockedReason: PushBlockedReason | null;
  activeSession: { id: string; deviceId: string; state: string } | null;
}

const STATE_TONE: Record<string, Tone> = {
  pushed: 'warn',
  reading: 'warn',
  details_confirmed: 'warn',
  signed: 'ok',
  walked_away: 'neutral',
  recalled: 'neutral',
  expired: 'neutral',
};

/** The words for a relationship key — the kiosk's own, read from one place. */
function relationshipLabel(key: string): string {
  return strings.kiosk.assignor.relationshipNames[key] ?? key;
}

/**
 * WHY THE PUSH WAS REFUSED, in our words. A code we do not recognise renders as
 * `other` rather than as nothing — an unhandled reason must still tell somebody
 * to go and look, never leave a silent button.
 */
export function blockedMessage(reason: string | null | undefined): string {
  if (!reason) return strings.tablet.blocked.other;
  return strings.tablet.blocked[reason] ?? strings.tablet.blocked.other;
}

/**
 * MAY THIS ACCOUNT ACTUALLY SEND, as against read the page?
 *
 * `mayReach` answers the page. The ACT is the practice's own — the same rule
 * `@PracticeScoped` states on the server — so it additionally needs the
 * `practice` audience, which an operator ACTING AS the practice holds by
 * construction and an operator merely looking does not. The same pair, and the
 * same reasoning, as `mayActOnDescriptions` on the reconciliation screen.
 */
export function mayPush(audiences: readonly Audience[]): boolean {
  return mayReach('/practice/tablet', audiences) && audiences.includes('practice');
}

/** "9:00", or the honest absence for a walk-in nobody booked. */
export function whenLabel(row: Pick<PushableRow, 'appointmentTime'>): string {
  return row.appointmentTime ?? strings.tablet.unbooked;
}

/**
 * "Service: General practitioner attendance" — label and value as ONE
 * string, always. A narrow column wrapping normal text word by word is a
 * width problem the grid solves; a label landing on a different line from
 * its own value is a structure problem, and rendering the pair as a single
 * string rather than as sibling expressions is what rules it out by
 * construction (`row_renders_facts_in_one_line_each`).
 */
export function serviceFact(row: Pick<PushableRow, 'serviceDescription' | 'serviceDescriptionValid'>): string {
  const value =
    row.serviceDescription && row.serviceDescriptionValid
      ? row.serviceDescription
      : row.serviceDescription
        ? strings.tablet.d6aStale
        : strings.tablet.d6aMissing;
  return `${strings.tablet.d6aLabel}: ${value}`;
}

/** "Signing: The patient" — the same one-string treatment as `serviceFact`. */
export function signingFact(
  row: Pick<PushableRow, 'assignorIsPatient' | 'assignorName' | 'assignorRelationship'>,
): string {
  const value = row.assignorIsPatient
    ? strings.tablet.signingPatient
    : row.assignorName
      ? strings.tablet.signingOther(row.assignorName, row.assignorRelationship ?? '')
      : strings.tablet.signingUnset;
  return `${strings.tablet.signingLabel}: ${value}`;
}

/** What the who-is-signing panel is holding, before it is saved. */
interface WhoDraft {
  isPatient: boolean;
  name: string;
  relationship: string;
  describe: string;
  declaredOfAge: boolean;
  mobile: string;
  email: string;
}

const EMPTY_WHO: WhoDraft = {
  isPatient: true,
  name: '',
  relationship: '',
  describe: '',
  declaredOfAge: false,
  mobile: '',
  email: '',
};

/**
 * THE GATE ON THE "SOMEONE ELSE" BRANCH — the single source of truth behind
 * both the disabled Save and the reason shown beside it.
 *
 * EVERY RULE COMES FROM `@aobplatform/domain`. The age threshold, the
 * relationship-to-authority mapping and the practice-staff comparison are all
 * imported; a literal 18 here would be a bug (the self-assign threshold moved
 * once already), and a second copy of the mapping would be the third copy of
 * the mistake hard rule 14 exists to prevent. The SERVER runs the identical
 * refusals inside `buildAssignorForAnother` before it will re-point an
 * agreement, so this disables a control the server would refuse rather than
 * deciding anything of its own.
 *
 * THE STAFF BLOCK FAILS TOWARD THE DESK. If the staff list could not be
 * fetched the block cannot fire, so an unknown list is treated as "not yet
 * checked" and Save stays available — the server still refuses, with the same
 * sentence. A page that silently stopped blocking would be worse than one that
 * defers to the endpoint that always checks.
 *
 * THERE IS NO CAPACITY QUESTION HERE and no parameter for one (REQ-VUL-05).
 * The absence is the requirement.
 */
export function whoIsBlocked(draft: WhoDraft, staffNames: readonly string[]): string | null {
  if (draft.isPatient) return null;
  if (draft.name.trim().length === 0) return strings.tablet.whoBlockedName;
  if (draft.relationship.length === 0) return strings.tablet.whoBlockedRelationship;
  if (relationshipNeedsFreeText(draft.relationship) && draft.describe.trim().length === 0) {
    return strings.tablet.whoBlockedDescribe;
  }
  if (matchesPracticeStaff(draft.name, staffNames)) return strings.tablet.whoBlockedStaff;
  if (!draft.declaredOfAge) return strings.tablet.whoBlockedAge;
  if (draft.mobile.trim().length === 0 && draft.email.trim().length === 0) {
    return strings.tablet.whoBlockedContact;
  }
  return null;
}

async function refusal(res: Response): Promise<{ message: string; reason?: string }> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; reason?: string };
  const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status));
  return { message, reason: body.reason };
}

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

export function TabletView({ practiceId }: { practiceId: string }) {
  const [rows, setRows] = useState<PushableRow[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [sessions, setSessions] = useState<TabletSessionRow[]>([]);
  const [staffNames, setStaffNames] = useState<readonly string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Which row's who-is-signing panel is open, and what it holds. */
  const [whoFor, setWhoFor] = useState<string | null>(null);
  const [who, setWho] = useState<WhoDraft>(EMPTY_WHO);
  const [whoBusy, setWhoBusy] = useState(false);
  const [whoOutcome, setWhoOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  /** Which tablet each row would go to, and what happened when it went. */
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushOutcome, setPushOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  /*
   * THE SESSION'S OWN CLAIM, NEVER THE PAGE'S `practiceId` PROP. The prop says
   * which practice the page is ABOUT; only the token says what the caller may
   * DO. Feeding the prop in as a fallback is precisely the bug a test caught on
   * the reconciliation screen — it granted the `practice` audience to a
   * platform operator looking at somebody else's page and enabled the control.
   */
  const audiences: Audience[] = useMemo(() => {
    const session = currentSession();
    return audiencesOf({
      roles: session?.roles,
      practiceId: session?.practiceId ?? null,
      practitionerId: session?.practitionerId,
    });
  }, []);
  const canSend = mayPush(audiences);

  const load = useCallback(async () => {
    try {
      const [p, d, s] = await Promise.all([
        fetch(`${CORE_URL}/tablet-sessions/pushable`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/devices`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/tablet-sessions?active=true`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!p.ok || !d.ok || !s.ok) throw new Error(String(p.ok ? (d.ok ? s.status : d.status) : p.status));
      setRows((await p.json()) as PushableRow[]);
      setDevices(((await d.json()) as { devices: DeviceRow[] }).devices);
      setSessions((await s.json()) as TabletSessionRow[]);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId]);

  /*
   * THE PRACTICE'S OWN STAFF NAMES, for the REQ-VUL-04 block. Fetched once,
   * held in memory, compared against and NEVER displayed. A failure leaves the
   * list empty, which leaves the block unable to fire — and the server's
   * identical refusal is what still holds.
   */
  useEffect(() => {
    void fetch(`${CORE_URL}/practice-users`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { users?: Array<{ name?: string }> }) =>
        setStaffNames((body.users ?? []).map((u) => u.name).filter((n): n is string => typeof n === 'string')),
      )
      .catch(() => setStaffNames([]));
  }, [practiceId]);

  /*
   * A POLL, NOT A SOCKET, for the reason §9.4 gives about the kiosk: a dead
   * socket fails silently and a poll fails visibly. `useRef` holds the latest
   * `load` so the interval is installed once rather than torn down and rebuilt
   * on every render, which is what turns a three-second poll into a burst.
   */
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    void latest.current();
    const timer = setInterval(() => void latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [practiceId]);

  function openWho(row: PushableRow) {
    setWhoOutcome(null);
    setWhoFor(row.agreementId);
    setWho({
      ...EMPTY_WHO,
      isPatient: row.assignorIsPatient,
      name: row.assignorIsPatient ? '' : (row.assignorName ?? ''),
    });
  }

  async function saveWho(row: PushableRow) {
    setWhoBusy(true);
    setWhoOutcome(null);
    try {
      const body = who.isPatient
        ? { assignorIsPatient: true }
        : {
            assignorIsPatient: false,
            name: who.name.trim(),
            /*
             * THE BASIS IS DERIVED FROM THE RELATIONSHIP, through versioned
             * content, and BOTH are sent. REQ-VUL-01 names them as separate
             * attributes: the basis is the legal ground for acting, the
             * relationship is the fact C8 prints on the agreement. The version
             * travels too, so the stored record says which list the answer came
             * from (hard rule 14).
             */
            ...(() => {
              const derived = authorityBasisFor(
                who.relationship,
                relationshipNeedsFreeText(who.relationship)
                  ? who.describe.trim()
                  : relationshipLabel(who.relationship),
              );
              return derived ? { authorityBasis: derived.authorityBasis, note: derived.note ?? undefined } : {};
            })(),
            relationship: relationshipNeedsFreeText(who.relationship)
              ? who.describe.trim()
              : relationshipLabel(who.relationship),
            relationshipsVersion: ASSIGNOR_RELATIONSHIPS_VERSION,
            // A DECLARATION, recorded and never verified (REQ-AGE-01,
            // REQ-VUL-02). No date of birth is asked for or stored.
            declaresEighteenOrOver: who.declaredOfAge,
            mobile: who.mobile.trim() || undefined,
            email: who.email.trim() || undefined,
          };

      const res = await fetch(`${CORE_URL}/agreements/${row.agreementId}/assignor`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await refusal(res)).message);
      setWhoOutcome({ id: row.agreementId, text: strings.tablet.whoSaved, ok: true });
      setWhoFor(null);
      // Re-read rather than patch: what is on screen is what the server thinks.
      await load();
    } catch (e) {
      setWhoOutcome({
        id: row.agreementId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setWhoBusy(false);
    }
  }

  async function send(row: PushableRow) {
    const deviceId = target[row.agreementId];
    if (!deviceId) return;
    setBusyId(row.agreementId);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/devices/${deviceId}/push`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ agreementId: row.agreementId }),
      });
      if (!res.ok) {
        // THE SERVER'S REASON, IN OUR WORDS — a rule, never the patient's data.
        const { reason } = await refusal(res);
        throw new Error(blockedMessage(reason));
      }
      await load();
    } catch (e) {
      setPushOutcome({
        id: row.agreementId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function recall(session: TabletSessionRow) {
    setBusyId(session.id);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/tablet-sessions/${session.id}/recall`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await refusal(res)).message);
      await load();
    } catch (e) {
      setPushOutcome({
        id: session.id,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  const sessionByDevice = new Map(sessions.map((s) => [s.deviceId, s]));
  const paired = (devices ?? []).filter((d) => d.state !== 'revoked');
  const free = paired.filter((d) => d.state === 'paired' && !sessionByDevice.has(d.id));

  if (loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.tablet.audience} />}
        title={strings.tablet.title}
        lead={strings.tablet.lead}
      >
        <Notice tone="stop" title={strings.tablet.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.tablet.audience} />}
      title={strings.tablet.title}
      lead={strings.tablet.lead}
    >
      {/*
        WHAT SENDING ACTUALLY DOES, standing on the screen rather than buried in
        help. The person pressing the button is making a legal record — that
        they checked this patient at the desk — and the platform should say so
        before they press it, not afterwards.
      */}
      <Notice tone="ok" title={strings.tablet.whatItDoes} data-testid="tablet-what-it-does">
        {strings.tablet.neverBlocks}
      </Notice>

      {loadError && (
        <Notice tone="warn" title={strings.tablet.notLoaded}>
          {loadError}
        </Notice>
      )}

      {/*
        LOOKING, NOT WORKING. Somebody without the practice's own claim — a
        platform operator who has not opened an acting-as session — sees the
        state and no controls. It is not a hidden page: the person most likely
        to be asked "why did that tablet not get the agreement" is exactly the
        person who needs to see the answer, and every act behind it is
        `@PracticeScoped` on the server and would refuse them anyway.
      */}
      {!canSend && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="tablet-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      <Section number={1} title={strings.tablet.todayTitle}>
        <p className={ui.hint}>{strings.tablet.todayLead}</p>

        <div className={styles.queueSummary}>
          <Chip tone={rows && rows.length ? 'warn' : 'ok'}>
            {strings.tablet.todayCount(rows?.length ?? 0)}
          </Chip>
          <Button variant="subtle" onClick={() => void load()} disabled={busyId !== null}>
            {strings.tablet.refresh}
          </Button>
        </div>

        {rows === null && <p className={ui.hint}>{strings.tablet.loading}</p>}

        {rows !== null && rows.length === 0 && (
          <div className={styles.empty}>
            <ClipboardList size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.tablet.todayNone}</p>
          </div>
        )}

        <ul className={styles.queueList} data-testid="pushable-list">
          {(rows ?? []).map((row) => {
            const live = row.activeSession
              ? sessions.find((s) => s.id === row.activeSession!.id)
              : undefined;
            const outcome = pushOutcome?.id === row.agreementId ? pushOutcome : null;
            const whoSaid = whoOutcome?.id === row.agreementId ? whoOutcome : null;
            const blocked = whoIsBlocked(who, staffNames);

            return (
              <li
                key={row.agreementId}
                className={rowStyles.row}
                data-testid={`pushable-${row.agreementId}`}
              >
                {/* WHO THIS IS. */}
                <div className={rowStyles.identity}>
                  <strong>{row.patientName}</strong>
                  <div className={ui.hint}>
                    {[row.providerName, whenLabel(row)].filter(Boolean).join(' · ')}
                  </div>
                  {live && (
                    <Chip tone={STATE_TONE[live.state] ?? 'neutral'}>
                      {strings.tablet.onTabletNow(live.deviceLabel)}
                    </Chip>
                  )}
                </div>

                {/*
                  WHAT THE VISIT IS. Label and value are rendered as ONE
                  string each (`serviceFact` / `signingFact`) so there is
                  nothing for a narrow column to split a fact across two
                  lines — the column just wraps the whole fact, never a word
                  at a time (`row_renders_facts_in_one_line_each`).
                */}
                <div className={rowStyles.facts}>
                  <p className={`${ui.hint} ${rowStyles.fact}`}>{serviceFact(row)}</p>
                  <p className={`${ui.hint} ${rowStyles.fact}`}>{signingFact(row)}</p>
                  {/*
                    ENDURING IS GP-ONLY (hard rule 6). Where the provider is not
                    a general practitioner the screen says what to offer
                    instead — a Treatment Plan Assignment — rather than leaving
                    somebody to discover that enduring is not on the menu.
                  */}
                  {row.agreementType === 'enduring' && row.providerType !== 'general_practitioner' && (
                    <p className={`${ui.hint} ${rowStyles.fact}`} data-testid={`enduring-gp-only-${row.agreementId}`}>
                      {strings.tablet.enduringGpOnly}
                    </p>
                  )}
                </div>

                {/*
                  WHO IS SIGNING, SET AT THE DESK — before the push, never on
                  the tablet. D7 is explicit and never inferred (CLAUDE.md §3).
                */}
                <div className={rowStyles.who}>
                  <Button
                    variant="subtle"
                    disabled={!canSend || row.particularsLocked}
                    onClick={() => (whoFor === row.agreementId ? setWhoFor(null) : openWho(row))}
                    data-testid={`who-open-${row.agreementId}`}
                  >
                    <UserRound size={14} aria-hidden="true" />
                    {whoFor === row.agreementId ? strings.tablet.whoClose : strings.tablet.whoOpen}
                  </Button>
                </div>

                {/*
                  WHERE IT GOES. Send is dead until the row can actually go — a
                  control that can only fail is a control that teaches people
                  the page is broken (CLAUDE.md §6). Blocked, its title carries
                  the reason as a tooltip; the reason itself is stated once,
                  in the full-width band below, never folded into the button's
                  own visible label as well.
                */}
                <div className={rowStyles.send}>
                  <SelectInput
                    id={`target-${row.agreementId}`}
                    aria-label={strings.tablet.sendChoose}
                    value={target[row.agreementId] ?? ''}
                    disabled={!canSend || !row.pushable || free.length === 0 || busyId !== null}
                    onChange={(e) => setTarget((t) => ({ ...t, [row.agreementId]: e.target.value }))}
                    data-testid={`target-${row.agreementId}`}
                  >
                    <option value="">{strings.tablet.sendChoose}</option>
                    {free.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </SelectInput>
                  <Button
                    variant="primary"
                    disabled={!canSend || !row.pushable || !target[row.agreementId] || busyId !== null}
                    title={row.pushable ? undefined : blockedMessage(row.blockedReason)}
                    onClick={() => void send(row)}
                    data-testid={`send-${row.agreementId}`}
                  >
                    <Send size={14} aria-hidden="true" />
                    {busyId === row.agreementId
                      ? strings.tablet.sending
                      : row.pushable
                        ? strings.tablet.sendAction
                        : strings.tablet.sendBlocked}
                  </Button>
                </div>

                {/*
                  THE REASON IT CANNOT GO, on the row, always — never only after
                  somebody presses something. This is Carl's live test made
                  structural: reception must be able to see who needs fixing.
                  Its own full-width band beneath the facts, never sharing a
                  track with — and so never overlapping — the send column.
                */}
                {!row.pushable && (
                  <div className={rowStyles.band}>
                    <Notice tone="warn" title={strings.tablet.sendBlocked} data-testid={`blocked-${row.agreementId}`}>
                      {blockedMessage(row.blockedReason)}
                    </Notice>
                  </div>
                )}

                {outcome && (
                  <div className={rowStyles.band}>
                    <Notice
                      tone={outcome.ok ? 'ok' : 'stop'}
                      title={strings.tablet.sendBlocked}
                      data-testid={`push-outcome-${row.agreementId}`}
                    >
                      {outcome.text}
                    </Notice>
                  </div>
                )}

                {whoSaid && (
                  <div className={rowStyles.band}>
                    <Notice
                      tone={whoSaid.ok ? 'ok' : 'stop'}
                      title={strings.tablet.whoTitle}
                      data-testid={`who-outcome-${row.agreementId}`}
                    >
                      {whoSaid.text}
                    </Notice>
                  </div>
                )}

                {whoFor === row.agreementId && (
                  <div
                    className={`${styles.cardBody} ${rowStyles.band}`}
                    data-testid={`who-panel-${row.agreementId}`}
                  >
                    <Checkbox
                      checked={who.isPatient}
                      onCheckedChange={(v) => setWho((w) => ({ ...w, isPatient: v }))}
                      label={strings.tablet.whoPatient}
                    />
                    {!who.isPatient && (
                      <>
                        <p className={ui.hint}>{strings.tablet.whoOther}</p>
                        <Field label={strings.tablet.whoName} required>
                          {(p) => (
                            <TextInput
                              {...p}
                              value={who.name}
                              maxLength={200}
                              onChange={(e) => setWho((w) => ({ ...w, name: e.target.value }))}
                              data-testid={`who-name-${row.agreementId}`}
                            />
                          )}
                        </Field>
                        <Field label={strings.tablet.whoRelationship} required>
                          {(p) => (
                            <SelectInput
                              {...p}
                              value={who.relationship}
                              onChange={(e) => setWho((w) => ({ ...w, relationship: e.target.value }))}
                              data-testid={`who-relationship-${row.agreementId}`}
                            >
                              <option value="">{strings.tablet.whoRelationshipPlaceholder}</option>
                              {/*
                                THE OPTIONS AND THEIR ORDER COME FROM VERSIONED
                                CONTENT (hard rule 14), never from this file.
                                Only the words are in the string table, keyed by
                                the content file's key.
                              */}
                              {ASSIGNOR_RELATIONSHIP_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {relationshipLabel(option.key)}
                                </option>
                              ))}
                            </SelectInput>
                          )}
                        </Field>
                        {relationshipNeedsFreeText(who.relationship) && (
                          <Field label={strings.tablet.whoDescribe} required>
                            {(p) => (
                              <TextInput
                                {...p}
                                value={who.describe}
                                maxLength={500}
                                onChange={(e) => setWho((w) => ({ ...w, describe: e.target.value }))}
                                data-testid={`who-describe-${row.agreementId}`}
                              />
                            )}
                          </Field>
                        )}
                        <Checkbox
                          checked={who.declaredOfAge}
                          onCheckedChange={(v) => setWho((w) => ({ ...w, declaredOfAge: v }))}
                          // The threshold is imported, never typed here.
                          label={strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER)}
                        />
                        <p className={ui.hint}>{strings.tablet.whoContactHint}</p>
                        <Field label={strings.tablet.whoMobile}>
                          {(p) => (
                            <TextInput
                              {...p}
                              value={who.mobile}
                              maxLength={30}
                              onChange={(e) => setWho((w) => ({ ...w, mobile: e.target.value }))}
                              data-testid={`who-mobile-${row.agreementId}`}
                            />
                          )}
                        </Field>
                        <Field label={strings.tablet.whoEmail}>
                          {(p) => (
                            <TextInput
                              {...p}
                              value={who.email}
                              maxLength={254}
                              onChange={(e) => setWho((w) => ({ ...w, email: e.target.value }))}
                              data-testid={`who-email-${row.agreementId}`}
                            />
                          )}
                        </Field>
                      </>
                    )}
                    <div className={styles.formActions}>
                      <Button
                        variant="primary"
                        disabled={!canSend || whoBusy || blocked !== null}
                        onClick={() => void saveWho(row)}
                        data-testid={`who-save-${row.agreementId}`}
                      >
                        {whoBusy ? strings.tablet.whoSaving : strings.tablet.whoSave}
                      </Button>
                      {/* The REASON the button is dead, beside the dead button. */}
                      {blocked && (
                        <span className={ui.hint} data-testid={`who-blocked-${row.agreementId}`}>
                          {blocked}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section number={2} title={strings.tablet.tabletsTitle}>
        <p className={ui.hint}>{strings.tablet.tabletsLead}</p>

        {devices !== null && paired.length === 0 && (
          <div className={styles.empty}>
            <Tablet size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.tablet.tabletsNone}</p>
            <p className={ui.hint}>{strings.tablet.tabletsNoneHint}</p>
          </div>
        )}

        <ul className={styles.list} data-testid="tablet-list">
          {(devices ?? []).map((device) => {
            const session = sessionByDevice.get(device.id);
            const outcome = session && pushOutcome?.id === session.id ? pushOutcome : null;
            return (
              <li key={device.id} className={styles.card} data-testid={`tablet-${device.id}`}>
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon}>
                    <Tablet size={18} aria-hidden="true" />
                  </span>
                  <div className={styles.cardMain}>
                    <p className={styles.cardTitle}>{device.label}</p>
                    {/*
                      A STATUS, NOT A MIRROR. A name and a state — never the
                      particulars the tablet is showing, which would put a
                      patient's date of birth on a second screen at the counter.
                    */}
                    <p className={styles.cardSub} data-testid={`tablet-state-${device.id}`}>
                      {device.state === 'revoked'
                        ? strings.tablet.tabletRevoked
                        : device.state === 'awaiting_pairing'
                          ? strings.tablet.tabletUnpaired
                          : session
                            ? strings.tablet.tabletShowing(
                                session.patientName,
                                strings.tablet.states[session.state] ?? session.state,
                              )
                            : strings.tablet.tabletIdle}
                    </p>
                    {session && (
                      <p className={styles.cardSub}>
                        {strings.tablet.pushedAt(session.pushedBy, when(session.pushedAt))}
                      </p>
                    )}
                  </div>
                  <div className={styles.cardAside}>
                    <Chip tone={session ? (STATE_TONE[session.state] ?? 'neutral') : 'ok'}>
                      {session ? (strings.tablet.states[session.state] ?? session.state) : strings.tablet.tabletIdle}
                    </Chip>
                  </div>
                </div>

                {session && (
                  <div className={styles.cardActions}>
                    {/*
                      RECALL TAKES THE SCREEN BACK AND NOTHING ELSE. The
                      agreement is untouched — the patient can be handed the
                      tablet again in a minute, sign by another channel, or be
                      billed privately (REQ-REC-04).
                    */}
                    <Button
                      disabled={!canSend || busyId !== null}
                      onClick={() => void recall(session)}
                      data-testid={`recall-${session.id}`}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      {busyId === session.id ? strings.tablet.recalling : strings.tablet.recallAction}
                    </Button>
                  </div>
                )}

                {outcome && (
                  <Notice tone="stop" title={strings.tablet.recallAction} data-testid={`recall-outcome-${device.id}`}>
                    {outcome.text}
                  </Notice>
                )}
              </li>
            );
          })}
        </ul>

        <p className={ui.hint}>
          <ArrowRight size={12} aria-hidden="true" /> {strings.tablet.tabletsNoneHint}
        </p>
      </Section>
    </Shell>
  );
}
