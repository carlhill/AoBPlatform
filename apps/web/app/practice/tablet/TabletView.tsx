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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCheck, ClipboardList, PencilLine, RotateCcw, Send, Tablet, UserRound } from 'lucide-react';
import {
  ASSIGNOR_RELATIONSHIPS_VERSION,
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  CORRECTABLE_PATIENT_FIELDS,
  ENDED_TABLET_SESSION_STATES,
  MIN_AGE_ASSIGN_FOR_OTHER,
  audiencesOf,
  authorityBasisFor,
  detailTypeForPatientField,
  isCorrectablePatientField,
  matchesPracticeStaff,
  mayReach,
  relationshipNeedsFreeText,
  type Audience,
  type CorrectablePatientField,
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
  // STOP, NOT WARN. Every other live state is "carry on watching"; this one is
  // the only one that needs somebody to get up and do something.
  details_disputed: 'stop',
  signed: 'ok',
  walked_away: 'neutral',
  // The tablet's own clock and the server's backstop. Neither is a failure and
  // neither needs anybody to move, so both read as neutral — the difference
  // between them is in the WORDS (`strings.tablet.states`), not in the colour.
  timed_out: 'neutral',
  recalled: 'neutral',
  expired: 'neutral',
};

/**
 * WHICH ENDINGS STILL HAVE SOMETHING TO SEND (Carl, 4 Sep 2026).
 *
 * Walking away, timing out, being recalled and expiring all leave the
 * AGREEMENT exactly as it was — that is hard rule 8 in the session table
 * (REQ-REC-04), and it is what makes "send it again" the ordinary next thing
 * rather than a repair. `signed` is the one ending with nothing left to do,
 * and it is excluded by NAME rather than by listing the other four, so an
 * ending added to the domain later shows up here instead of being silently
 * dropped.
 */
export const SEND_AGAIN_ENDINGS: readonly string[] = ENDED_TABLET_SESSION_STATES.filter(
  (state) => state !== 'signed',
);

/**
 * THE SESSIONS THAT STILL OWN A TABLET. The poll asks for the last
 * twenty-four hours so an ENDED session can offer "Send again"; everything
 * that reasons about what a tablet is doing right now — which device is free,
 * who is in the way of a `device_busy` refusal — must filter first, or a
 * receptionist is told the tablet is showing somebody who left at nine.
 */
export function liveOnly(sessions: readonly TabletSessionRow[]): TabletSessionRow[] {
  return sessions.filter((session) => session.endedAt === null);
}

/**
 * THE FIRST EIGHT CHARACTERS OF A SESSION ID (Carl, 4 Sep 2026).
 *
 * The tablet's own footer carries the same eight, so reception and a tablet
 * can be matched BY EYE — which is what testing needs and what an audit needs
 * later, when somebody asks which screen a signature came off. Eight is enough
 * to be unique among the handful of sessions a practice has open in a day and
 * short enough to read across a desk; the full id is still what every call
 * carries.
 *
 * AN ID IS NOT A DETAIL ABOUT A PERSON. It names a session row — the same
 * thing the vault events name — so showing it adds nothing about the patient
 * to a screen that faces the room.
 */
export function shortSessionId(id: string): string {
  return id.slice(0, 8);
}

/** The short id, in the one typeface it can be compared in. */
function SessionTag({ id, testId }: { id: string; testId: string }) {
  return (
    <span className={rowStyles.sessionId} data-testid={testId}>
      {strings.tablet.sessionTag(shortSessionId(id))}
    </span>
  );
}

/** The words for a relationship key — the kiosk's own, read from one place. */
function relationshipLabel(key: string): string {
  return strings.kiosk.assignor.relationshipNames[key] ?? key;
}

/**
 * WHAT THE PATIENT CROSSED, IN WORDS — "address, mobile number".
 *
 * THE WORDS ARE THE KIOSK'S OWN, read from one place. The patient tapped a
 * button labelled "Address"; reception must read the same word, or the two
 * halves of one conversation are describing different things. The wire carries
 * `address` and never a value (REQ-VER-04), which is why this maps a TYPE
 * rather than rendering something the server sent.
 */
export function disputedLabels(types: readonly string[]): string {
  return types.map((type) => strings.kiosk.checkDetails.detailNames[type] ?? type).join(', ');
}

/**
 * WHICH COLUMNS ANSWER A CROSSED ROW. The patient crossed "Name"; reception
 * corrects given names AND family name, because a person does not read their
 * name as two questions and the platform stores it as two columns.
 *
 * SINCE 4 SEP 2026 THIS DECIDES WHAT IS MARKED, NOT WHAT IS SHOWN. The
 * correction panel opens ALL five details (Carl: "just in case the patient
 * says my mobile is also wrong but I ticked yes"); this maps the crossed types
 * onto the columns that answer them, so those fields are highlighted while the
 * rest are simply available.
 */
export const FIELDS_FOR_DISPUTED_TYPE: Readonly<Record<string, readonly CorrectablePatientField[]>> = {
  name: ['givenNames', 'familyName'],
  date_of_birth: ['dateOfBirth'],
  address: ['address'],
  mobile: ['mobile'],
  email: ['email'],
};

export function fieldsToCorrect(types: readonly string[]): CorrectablePatientField[] {
  const fields: CorrectablePatientField[] = [];
  for (const type of types) {
    for (const field of FIELDS_FOR_DISPUTED_TYPE[type] ?? []) {
      if (!fields.includes(field)) fields.push(field);
    }
  }
  return fields;
}

/** The six correctable details, as the server hands them back. */
export interface PatientDetails {
  id: string;
  givenNames: string;
  familyName: string;
  dateOfBirth: string;
  address: string | null;
  mobile: string | null;
  email: string | null;
  detailsCorrectedAt: string | null;
}

/**
 * WHAT ONE REFUSAL SHOWS: the sentence, and — where there is somewhere to go
 * — a link or a Recall action right there in the band (Carl, 4 Sep 2026: a
 * pushable row that the server then refused told reception nothing true and
 * pointed at a screen that does not exist).
 *
 * A LINK ONLY WHERE ONE EXISTS. `agreement_not_pushable` and
 * `patient_confidential` have no page of their own yet — no
 * `/practice/agreements/:id` and no per-patient page exist in this app — so
 * `agreement_not_pushable` still links to the reconciliation screen (the
 * closest real place to look) and `patient_confidential` carries no link at
 * all, on purpose, rather than one that would 404.
 */
export interface RefusalDescription {
  text: string;
  link?: { href: string; label: string };
  /** Present only for `device_busy`, and only once a live session id is known. */
  recallSessionId?: string;
  /** Present only for the unmapped fallback, so a caller can assert the code was not swallowed. */
  code?: string;
  /**
   * THE REASON, CARRIED THROUGH, so a band can offer the FIX and not only the
   * sentence. `service_description_missing` is the one that has an inline
   * control today (Carl, 4 Sep 2026): the description is chosen on the blocked
   * row itself rather than on a screen two clicks away. Every other reason
   * ignores it.
   */
  reason?: string;
}

/**
 * WHY THE PUSH WAS REFUSED, in our words, with somewhere to go.
 *
 * `ctx` carries what only the CALLER knows at the moment of a refusal — which
 * tablet was chosen, who is on it right now, and the row's own provider type
 * — never guessed at here. A code this build has not met yet still renders
 * with the raw CODE on screen (`other`), never a sentence that sends
 * reception looking for "the practice queue".
 */
export function describeRefusal(
  reason: string | null | undefined,
  ctx: {
    deviceLabel?: string;
    patientName?: string;
    sessionId?: string;
    providerType?: string | null;
    rawMessage?: string;
  } = {},
): RefusalDescription {
  switch (reason) {
    case 'device_busy':
      return {
        reason,
        text: strings.tablet.blocked.device_busy(
          ctx.deviceLabel ?? strings.tablet.blocked.device_busySomeone,
          ctx.patientName ?? strings.tablet.blocked.device_busySomeone,
        ),
        recallSessionId: ctx.sessionId,
      };
    case 'service_description_missing':
      return {
        reason,
        text: strings.tablet.blocked.service_description_missing,
        // SECONDARY, now that the description is set on the row itself. The
        // link is still here because the reconciliation row carries the rest
        // of the record, and somebody may want it.
        link: { href: '/practice/reconciliation', label: strings.tablet.toReconciliationForD6a },
      };
    case 'agreement_not_pushable':
      return {
        reason,
        text: strings.tablet.blocked.agreement_not_pushable,
        link: { href: '/practice/reconciliation', label: strings.tablet.toReconciliationRow },
      };
    case 'device_revoked':
      return {
        reason,
        text: strings.tablet.blocked.device_revoked,
        link: { href: '/practice/devices', label: strings.tablet.toDevices },
      };
    case 'device_not_paired':
      return {
        reason,
        text: strings.tablet.blocked.device_not_paired,
        link: { href: '/practice/devices', label: strings.tablet.toDevices },
      };
    case 'enduring_not_supported': {
      const nonGp = ctx.providerType != null && ctx.providerType !== 'general_practitioner';
      return {
        reason,
        text: nonGp
          ? `${strings.tablet.blocked.enduring_not_supported} ${strings.tablet.enduringOfferOther}`
          : strings.tablet.blocked.enduring_not_supported,
      };
    }
    case 'who_is_signing_unset':
      return { reason, text: strings.tablet.blocked.who_is_signing_unset };
    case 'patient_confidential':
      // No per-patient page exists in this app yet — carrying no link here is
      // deliberate rather than an oversight (see the doc comment above).
      return { reason, text: strings.tablet.blocked.patient_confidential };
    case 'device_unknown':
      return { reason, text: strings.tablet.blocked.device_unknown };
    case 'agreement_not_found':
      return { reason, text: strings.tablet.blocked.agreement_not_found };
    default: {
      if (reason) return { text: strings.tablet.blocked.other(reason), code: reason };
      return { text: ctx.rawMessage ?? strings.tablet.blocked.otherNoCode };
    }
  }
}

/** The sentence alone, for the places that show only text (a dead button's tooltip). */
export function blockedMessage(
  reason: string | null | undefined,
  ctx?: { providerType?: string | null },
): string {
  return describeRefusal(reason, ctx).text;
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

/**
 * `sessionId` ONLY ARRIVES ON `device_busy` (`pushRefusals.deviceBusy`, in
 * `apps/core/src/tablet-sessions/push-refusal.ts`) — the live session that is
 * in the way, so the console can offer Recall rather than leaving reception
 * to work out why the button did nothing. Every other refusal carries only a
 * `reason` code and a message; nothing here is invented when the body does
 * not have it.
 */
async function refusal(res: Response): Promise<{ message: string; reason?: string; sessionId?: string }> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    reason?: string;
    sessionId?: string;
  };
  const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status));
  return { message, reason: body.reason, sessionId: body.sessionId };
}

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * ONE REFUSAL, RENDERED — the sentence, and whatever the reason carries: a
 * link (`service_description_missing`, `agreement_not_pushable`,
 * `device_revoked`, `device_not_paired`) or a Recall button right in the band
 * (`device_busy`). Shared between the row's own outcome band and the tablet
 * card's, so a busy refusal met from either control (Send or Re-send) reads
 * and behaves the same way.
 */
function RefusalOutcomeBody({
  info,
  canSend,
  busy,
  onRecall,
  linkTestId,
  recallTestId,
  fix,
}: {
  info: RefusalDescription;
  canSend: boolean;
  busy: boolean;
  onRecall: (sessionId: string) => void;
  linkTestId: string;
  recallTestId: string;
  /**
   * THE FIX ITSELF, WHERE ONE FITS IN THE BAND — today only the D6a select
   * (Carl, 4 Sep 2026). It sits ABOVE the link on purpose: the control that
   * ends the problem here is the main answer, and the link is what to do
   * instead.
   */
  fix?: ReactNode;
}) {
  return (
    <>
      <p>{info.text}</p>
      {fix}
      {info.link && (
        <Link href={info.link.href} data-testid={linkTestId}>
          {info.link.label}
        </Link>
      )}
      {info.recallSessionId && (
        <div className={styles.formActions}>
          <Button
            variant="subtle"
            disabled={!canSend || busy}
            onClick={() => onRecall(info.recallSessionId!)}
            data-testid={recallTestId}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {strings.tablet.recallAction}
          </Button>
        </div>
      )}
    </>
  );
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

  /**
   * THE CORRECTION PANEL — which session's is open, the details as the server
   * last gave them, and what reception has typed.
   *
   * THE VALUES ARE FETCHED ON OPEN AND DROPPED ON CLOSE, never carried on the
   * three-second poll. A date of birth and a home address must not sit on a
   * monitor at the front counter, facing the room, all morning: reception is
   * watching a STATUS, and only becomes a corrector when they choose to.
   */
  const [correctFor, setCorrectFor] = useState<string | null>(null);
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [draft, setDraft] = useState<Partial<Record<CorrectablePatientField, string>>>({});
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctOutcome, setCorrectOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  /**
   * THE SERVICE DESCRIPTIONS, FETCHED ONCE AND NOT ON THE POLL. They are
   * versioned CONTENT (hard rule 14) and this component knows none of the
   * words — a copy in this file would be a second copy of the mapping the
   * rules engine matches, which is the exact failure versioning exists to
   * prevent. They change when a mapping is published, not every three
   * seconds, so re-reading them on the poll would be traffic for nothing.
   */
  const [descriptions, setDescriptions] = useState<{ version: string; descriptions: string[] } | null>(null);
  const [d6aChoice, setD6aChoice] = useState<Record<string, string>>({});
  const [d6aBusy, setD6aBusy] = useState<string | null>(null);
  const [d6aOutcome, setD6aOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  /**
   * Which tablet each row would go to, and what happened when it went.
   *
   * A REFUSAL CARRIES `info` RATHER THAN JUST `text` — the structured
   * sentence-plus-link-plus-Recall the band renders — so a refusal that has
   * somewhere to go actually shows it, not merely names it (Carl, 4 Sep
   * 2026). `text` alone still covers the unreachable-network case, which is
   * not a refusal the server sent at all.
   */
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushOutcome, setPushOutcome] = useState<{
    id: string;
    ok: boolean;
    text?: string;
    info?: RefusalDescription;
  } | null>(null);

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

  /**
   * RETURNS WHAT IT FETCHED, as well as setting state, so a refusal can read
   * FRESH sessions rather than the closure's stale ones. `device_busy` is, by
   * construction, a race: the device this screen still shows as free just
   * became busy on the server in the last few seconds (the same reasoning
   * `push()` itself gives for the unique-index race, in
   * `apps/core/src/tablet-sessions/tablet-sessions.service.ts`) — so the
   * session that is in the way is almost never in the array this closure
   * already holds, and re-reading it is the only honest way to name who is on
   * the tablet rather than fall back to `device_busySomeone`.
   */
  const load = useCallback(async () => {
    try {
      const [p, d, s] = await Promise.all([
        fetch(`${CORE_URL}/tablet-sessions/pushable`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/devices`, { headers: apiHeaders(practiceId) }),
        /*
         * THE LAST TWENTY-FOUR HOURS, NOT ONLY THE LIVE ONES (Carl, 4 Sep
         * 2026). A tablet whose session has ENDED — walked away, timed out,
         * recalled, expired — must offer "Send again" for that agreement
         * right there, and a list filtered to active sessions is a list in
         * which the row reception is looking at has just vanished. The live
         * view is derived below by filtering on `endedAt`, which the server
         * already sends; asking for both in one request is cheaper than two
         * polls three seconds apart.
         */
        fetch(`${CORE_URL}/tablet-sessions?active=false`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!p.ok || !d.ok || !s.ok) throw new Error(String(p.ok ? (d.ok ? s.status : d.status) : p.status));
      const freshRows = (await p.json()) as PushableRow[];
      const freshDevices = ((await d.json()) as { devices: DeviceRow[] }).devices;
      const freshSessions = (await s.json()) as TabletSessionRow[];
      setRows(freshRows);
      setDevices(freshDevices);
      setSessions(freshSessions);
      setLoadError(null);
      return { rows: freshRows, devices: freshDevices, sessions: freshSessions };
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
      return null;
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
   * THE D6a LIST, ONCE. A failure leaves the select unpopulated and the
   * inline control disabled — the reconciliation link in the same band is
   * still there, so the row is never a dead end (CLAUDE.md §7).
   */
  useEffect(() => {
    void fetch(`${CORE_URL}/service-descriptions`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { version?: string; descriptions?: string[] }) =>
        setDescriptions({ version: body.version ?? '', descriptions: body.descriptions ?? [] }),
      )
      .catch(() => setDescriptions(null));
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
        /*
         * THE SERVER'S REASON, IN OUR WORDS, WITH SOMEWHERE TO GO. `device_busy`
         * carries the live session's id (`pushRefusals.deviceBusy`); the
         * chosen tablet's own label is already on this screen (it is what
         * was just picked from the dropdown), and the patient on it is found
         * from the sessions this page already polls — the session id first,
         * the device id as a fallback if the id it named is not one we hold.
         */
        const { reason, sessionId } = await refusal(res);
        // A FRESH READ, because a `device_busy` session is almost never in
        // what this closure already holds (see the doc comment on `load`).
        const fresh = await load();
        const freshDevices = fresh?.devices ?? devices ?? [];
        const freshSessions = fresh?.sessions ?? sessions;
        const chosenDevice = freshDevices.find((d) => d.id === deviceId);
        // LIVE ONES ONLY. The poll now carries the last twenty-four hours, and
        // a session that ENDED cannot be the one in the way — naming its
        // patient would tell reception the tablet is showing somebody who
        // left an hour ago.
        const live = liveOnly(freshSessions);
        const busySession = sessionId
          ? (live.find((s) => s.id === sessionId) ?? live.find((s) => s.deviceId === deviceId))
          : live.find((s) => s.deviceId === deviceId);
        setPushOutcome({
          id: row.agreementId,
          ok: false,
          info: describeRefusal(reason, {
            deviceLabel: chosenDevice?.label,
            patientName: busySession?.patientName,
            sessionId: sessionId ?? busySession?.id,
            providerType: row.providerType,
          }),
        });
        return;
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

  /**
   * OPEN THE CORRECTION PANEL FOR ONE DISPUTED SESSION — and read the values
   * at that moment, from the server, rather than from anything this page was
   * already holding.
   */
  async function openCorrect(session: TabletSessionRow) {
    setCorrectOutcome(null);
    setCorrectFor(session.id);
    setDetails(null);
    setDraft({});
    try {
      const res = await fetch(`${CORE_URL}/patients/${session.patientId}/details`, {
        headers: apiHeaders(practiceId),
      });
      if (!res.ok) throw new Error((await refusal(res)).message);
      const body = (await res.json()) as PatientDetails;
      setDetails(body);
      /*
       * ALL FIVE DETAILS, PRE-FILLED (Carl, 4 Sep 2026: "just in case the
       * patient says my mobile is also wrong but I ticked yes"). A correction
       * is almost always an edit of one character in an address rather than a
       * re-typing of it, and a person answering five rows on a tablet is not a
       * reliable narrator of which ones are wrong — they tick along and
       * mention the rest across the desk. The crossed ones are MARKED below;
       * the rest are simply available, and `saveCorrection` still sends only
       * what actually changed.
       */
      const seed: Partial<Record<CorrectablePatientField, string>> = {};
      for (const field of CORRECTABLE_PATIENT_FIELDS) {
        seed[field] = (body[field] as string | null) ?? '';
      }
      setDraft(seed);
    } catch (e) {
      setCorrectOutcome({
        id: session.id,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    }
  }

  /**
   * SAVE THE CORRECTION. Only the fields reception actually changed are sent —
   * the server records one `patient.details_corrected` event per changed
   * field, with the TYPE and the staff member and never the value, and a
   * request full of unchanged fields would put events in the vault saying
   * somebody changed something when nobody did.
   */
  async function saveCorrection(session: TabletSessionRow) {
    if (!details) return;
    const body: Record<string, string> = {};
    for (const [field, value] of Object.entries(draft)) {
      const current =
        field === 'dateOfBirth'
          ? details.dateOfBirth
          : ((details[field as keyof PatientDetails] as string | null) ?? '');
      if ((value ?? '') !== current) body[field] = value ?? '';
    }
    if (Object.keys(body).length === 0) {
      setCorrectOutcome({ id: session.id, text: strings.tablet.correctNoChange, ok: false });
      return;
    }

    setCorrectBusy(true);
    setCorrectOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/patients/${session.patientId}/details`, {
        method: 'PATCH',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(body),
      });
      // THE SERVER'S OWN RULE TEXT, shown as it came. A refusal here is a rule
      // — the Medicare exclusion, a field that may not be corrected — and
      // paraphrasing it on the client would be a second copy of a rule that
      // has one home.
      if (!res.ok) throw new Error((await refusal(res)).message);

      /*
       * AND WHY IT WAS MADE, ON THE SESSION (Carl, 4 Sep 2026). The correction
       * itself already has an event; this closes the CROSS that prompted it,
       * so the dispute and its answer read as one story rather than two
       * unconnected facts. The types are those of the fields that actually
       * changed — which may include one the patient ticked, because a person
       * who crossed their address often mentions their mobile in the same
       * breath.
       */
      const changedTypes = [
        ...new Set(
          Object.keys(body)
            .filter(isCorrectablePatientField)
            .map((field) => detailTypeForPatientField(field)),
        ),
      ];
      const recorded = await recordResolution(session, 'corrected', changedTypes);
      setCorrectOutcome({
        id: session.id,
        text: recorded ? strings.tablet.correctSaved : strings.tablet.resolveNotRecorded,
        ok: recorded,
      });
      setCorrectFor(null);
      setDetails(null);
      setDraft({});
      await load();
    } catch (e) {
      setCorrectOutcome({
        id: session.id,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setCorrectBusy(false);
    }
  }

  /**
   * HOW THE DISPUTE ENDED, ON THE RECORD (Carl, 4 Sep 2026).
   *
   * Two answers and no third: `corrected` (reception changed the detail — the
   * change has its own event, this says why it was made) and `patient_error`
   * (the detail was right and the patient crossed it anyway). Both are
   * recorded against the staff member who says so, because "nothing was wrong
   * after all" is a claim somebody may be asked about later.
   *
   * IT RETURNS A BOOLEAN RATHER THAN THROWING, because its two callers want
   * different things from a failure: after a correction the change has ALREADY
   * been saved and reception must not be told it was not, so the message says
   * exactly what happened.
   *
   * TYPES ONLY, ON THE WIRE AND ON THE SCREEN (REQ-VER-04).
   */
  async function recordResolution(
    session: TabletSessionRow,
    outcome: 'corrected' | 'patient_error',
    types: readonly string[],
  ): Promise<boolean> {
    if (types.length === 0) return true;
    try {
      const res = await fetch(`${CORE_URL}/tablet-sessions/${session.id}/dispute-resolution`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ outcome, details: [...types] }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * "NO CHANGE NEEDED — THE DETAILS WERE RIGHT" (Carl, 4 Sep 2026).
   *
   * The second way out of a dispute, and the reason the endpoint exists: a
   * patient can cross a row that was correct. Without this the only exit was
   * to "correct" a detail needing no correction, which would put an event in
   * the vault saying somebody changed something when nobody did.
   *
   * NOTHING IS TOUCHED — not the patient, not the agreement, not the session.
   * The next press is Re-send, which pushes the SAME agreement, because no
   * particular moved and so nothing supersedes.
   */
  async function noChangeNeeded(session: TabletSessionRow) {
    setCorrectBusy(true);
    setCorrectOutcome(null);
    const ok = await recordResolution(session, 'patient_error', session.disputedDetails);
    setCorrectOutcome({
      id: session.id,
      text: ok ? strings.tablet.noChangeRecorded : strings.tablet.resolveNotRecorded,
      ok,
    });
    setCorrectBusy(false);
    if (ok) await load();
  }

  /**
   * SET D6a ON THE BLOCKED ROW ITSELF (Carl, 4 Sep 2026) — the shortcut to the
   * answer rather than directions to a screen (CLAUDE.md §7).
   *
   * THE SAME ENDPOINT THE RECONCILIATION SCREEN USES, unchanged: a staff
   * surface, a named actor the server requires, and the words chosen from the
   * server's own versioned list. This adds a second place to press it, not a
   * second way of doing it — and it deliberately does NOT lock, for the reason
   * `ServiceDescriptionsService` gives at length (locking here would close the
   * door on setting who is signing).
   *
   * THE LIST IS RE-READ AFTERWARDS rather than the row patched, so what is on
   * screen is what the server thinks — including whether the row is now
   * pushable, which is the whole point of pressing it.
   */
  async function setD6a(row: PushableRow) {
    const description = d6aChoice[row.agreementId];
    if (!description) return;
    setD6aBusy(row.agreementId);
    setD6aOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/service-descriptions/agreements/${row.agreementId}`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ description }),
      });
      // THE SERVER'S OWN RULE TEXT, as it came — a refusal here is the rules
      // engine or the versioned list speaking, and paraphrasing it on the
      // client would be a second copy of a rule that has one home.
      if (!res.ok) throw new Error((await refusal(res)).message);
      setD6aOutcome({ id: row.agreementId, text: strings.tablet.d6aSetDone, ok: true });
      await load();
    } catch (e) {
      setD6aOutcome({
        id: row.agreementId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setD6aBusy(null);
    }
  }

  /**
   * SEND IT AGAIN, TO THE TABLET THAT JUST FINISHED WITH IT (Carl, 4 Sep
   * 2026).
   *
   * A session that walked away, timed out, was recalled or expired left the
   * AGREEMENT untouched (hard rule 8, REQ-REC-04) — so this is an ordinary
   * push of the same agreement to the same tablet, not a repair, and it is the
   * SAME call the row's own Send makes. Refusals are the same codes and read
   * the same way, which is the point: there is one push in this product.
   */
  async function sendAgain(ended: TabletSessionRow) {
    setBusyId(ended.id);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/devices/${ended.deviceId}/push`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ agreementId: ended.agreementId }),
      });
      if (!res.ok) {
        const { reason, message, sessionId } = await refusal(res);
        const fresh = await load();
        const live = liveOnly(fresh?.sessions ?? sessions);
        const busySession = sessionId
          ? (live.find((s) => s.id === sessionId) ?? live.find((s) => s.deviceId === ended.deviceId))
          : live.find((s) => s.deviceId === ended.deviceId);
        setPushOutcome({
          id: ended.id,
          ok: false,
          info: describeRefusal(reason, {
            deviceLabel: ended.deviceLabel,
            patientName: busySession?.patientName,
            sessionId: sessionId ?? busySession?.id,
            rawMessage: message,
          }),
        });
        return;
      }
      await load();
    } catch (e) {
      setPushOutcome({
        id: ended.id,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * SEND IT AGAIN. One press: the old screen is recalled and the same tablet
   * gets a fresh session for the same visit, re-read from the corrected
   * records.
   *
   * IF THE CORRECTION TOUCHED A PARTICULAR ON A LOCKED AGREEMENT the server
   * supersedes rather than edits (HARD-02) and says so in the response, and
   * reception is told in words — the row's id changes under them, and a silent
   * replacement is how people stop trusting a screen.
   */
  async function resend(session: TabletSessionRow) {
    setBusyId(session.id);
    setCorrectOutcome(null);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/tablet-sessions/${session.id}/resend`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // RESEND REFUSES THE SAME WAY THE PUSH DOES — same codes, same
        // treatment, and the same tablet is already known (it is this row's).
        const { reason, message, sessionId } = await refusal(res);
        const fresh = await load();
        const live = liveOnly(fresh?.sessions ?? sessions);
        const busySession = sessionId
          ? (live.find((s) => s.id === sessionId) ?? live.find((s) => s.deviceId === session.deviceId))
          : live.find((s) => s.deviceId === session.deviceId);
        setPushOutcome({
          id: session.id,
          ok: false,
          info: describeRefusal(reason, {
            deviceLabel: session.deviceLabel,
            patientName: busySession?.patientName ?? session.patientName,
            sessionId: sessionId ?? busySession?.id,
            rawMessage: message,
          }),
        });
        return;
      }
      const body = (await res.json()) as { supersededAgreementId: string | null };
      setPushOutcome({
        id: session.id,
        text: body.supersededAgreementId ? strings.tablet.resendSuperseded : strings.tablet.resent,
        ok: true,
      });
      setCorrectFor(null);
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

  /** Recalled by SESSION ID, so both the tablet card's own button and a
   *  `device_busy` refusal's inline Recall (which knows only the id) can
   *  call the same function. */
  async function recall(sessionId: string) {
    setBusyId(sessionId);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/tablet-sessions/${sessionId}/recall`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await refusal(res)).message);
      await load();
    } catch (e) {
      setPushOutcome({
        id: sessionId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  /*
   * WHAT EACH TABLET IS DOING, AND WHAT IT LAST DID. The poll carries the last
   * twenty-four hours in one array; the live view is the sessions with no
   * `endedAt`, and a tablet with none of those shows its most recent ENDED
   * session instead, so "Send again" is on the row that just told reception it
   * ended (Carl, 4 Sep 2026).
   */
  const sessionByDevice = new Map(liveOnly(sessions).map((s) => [s.deviceId, s]));
  const lastEndedByDevice = new Map<string, TabletSessionRow>();
  for (const session of sessions) {
    if (session.endedAt === null) continue;
    if (sessionByDevice.has(session.deviceId)) continue;
    const held = lastEndedByDevice.get(session.deviceId);
    // The server orders by `pushedAt` desc; comparing anyway means a caller
    // that does not is still shown the latest rather than the first it sent.
    if (!held || held.lastStateAt < session.lastStateAt) lastEndedByDevice.set(session.deviceId, session);
  }
  /**
   * THE FIX, IN THE BAND THAT STATES THE PROBLEM (Carl, 4 Sep 2026). The one
   * thing standing between this patient and the tablet is a description of the
   * service, and the control that supplies it belongs here rather than two
   * screens away — "shortcuts to the answer, not directions to a screen"
   * (CLAUDE.md §7).
   *
   * THE WORDS COME FROM THE SERVER AND THE VERSION IS SHOWN. They are the
   * exact strings the rules engine matches and they are versioned content
   * (hard rule 14); a list in this file would be a second copy that goes stale
   * silently, so this component knows none of them and says which list it is
   * offering.
   */
  function d6aFix(row: PushableRow): ReactNode {
    const said = d6aOutcome?.id === row.agreementId ? d6aOutcome : null;
    return (
      <div className={rowStyles.fix} data-testid={`d6a-fix-${row.agreementId}`}>
        {descriptions && (
          <Chip tone="neutral">{strings.tablet.d6aListVersion(descriptions.version)}</Chip>
        )}
        <Field label={strings.tablet.d6aSetLabel}>
          {(p) => (
            <SelectInput
              {...p}
              value={d6aChoice[row.agreementId] ?? ''}
              disabled={!canSend || !descriptions || d6aBusy !== null}
              onChange={(e) => setD6aChoice((c) => ({ ...c, [row.agreementId]: e.target.value }))}
              data-testid={`d6a-select-${row.agreementId}`}
            >
              <option value="">{strings.tablet.d6aSetPlaceholder}</option>
              {/* IN THE ORDER THE SERVER SENT. File order is screen order. */}
              {(descriptions?.descriptions ?? []).map((description) => (
                <option key={description} value={description}>
                  {description}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <div className={styles.formActions}>
          <Button
            onClick={() => void setD6a(row)}
            disabled={!canSend || d6aBusy !== null || !d6aChoice[row.agreementId]}
            data-testid={`d6a-set-${row.agreementId}`}
          >
            {d6aBusy === row.agreementId ? strings.tablet.d6aSetting : strings.tablet.d6aSetAction}
          </Button>
        </div>
        {said && (
          <p className={ui.hint} data-testid={`d6a-outcome-${row.agreementId}`}>
            {said.text}
          </p>
        )}
      </div>
    );
  }

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
                      {strings.tablet.onTabletNow(live.deviceLabel)} ·{' '}
                      <SessionTag id={live.id} testId={`row-session-id-${row.agreementId}`} />
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
                    title={
                      row.pushable
                        ? undefined
                        : blockedMessage(row.blockedReason, { providerType: row.providerType })
                    }
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
                      <RefusalOutcomeBody
                        info={describeRefusal(row.blockedReason, { providerType: row.providerType })}
                        canSend={canSend}
                        busy={busyId !== null}
                        onRecall={(sessionId) => void recall(sessionId)}
                        linkTestId={`blocked-link-${row.agreementId}`}
                        recallTestId={`blocked-recall-${row.agreementId}`}
                        fix={
                          row.blockedReason === 'service_description_missing' ? d6aFix(row) : undefined
                        }
                      />
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
                      {/*
                        A REFUSAL WITH SOMEWHERE TO GO SHOWS IT, right here —
                        never only a sentence (Carl, 4 Sep 2026: a pushable row
                        that the server then refused sent reception looking for
                        "the practice queue", which does not exist). `device_busy`
                        offers Recall inline, so pressing it re-enables Send
                        without reception hunting the tablet down themselves.
                      */}
                      {outcome.info ? (
                        <RefusalOutcomeBody
                          info={outcome.info}
                          canSend={canSend}
                          busy={busyId !== null}
                          onRecall={(sessionId) => void recall(sessionId)}
                          linkTestId={`push-outcome-link-${row.agreementId}`}
                          recallTestId={`push-outcome-recall-${row.agreementId}`}
                          fix={
                            outcome.info.reason === 'service_description_missing'
                              ? d6aFix(row)
                              : undefined
                          }
                        />
                      ) : (
                        outcome.text
                      )}
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
            const lastEnded = lastEndedByDevice.get(device.id);
            /*
             * WHAT THIS TABLET LAST DID, when it is doing nothing (Carl, 4 Sep
             * 2026). A session that walked away, timed out, was recalled or
             * expired left the agreement untouched, so the ordinary next thing
             * is to send it again — on the row that just said it ended, rather
             * than after a hunt back through the waiting list.
             */
            const ended =
              !session && lastEnded && SEND_AGAIN_ENDINGS.includes(lastEnded.state) ? lastEnded : undefined;
            const outcome =
              pushOutcome && (pushOutcome.id === session?.id || pushOutcome.id === ended?.id)
                ? pushOutcome
                : null;
            /*
             * WHETHER IT COULD ACTUALLY GO, read from the list this page
             * already polls — dead until valid (CLAUDE.md §6). An agreement no
             * longer on the pushable list has moved on: signed, superseded, or
             * captured another way, which is exactly what
             * `agreement_not_pushable` says.
             */
            const againRow = ended ? (rows ?? []).find((r) => r.agreementId === ended.agreementId) : undefined;
            const againBlocked: string | null = !ended
              ? null
              : againRow
                ? (againRow.pushable ? null : (againRow.blockedReason ?? 'agreement_not_pushable'))
                : rows === null
                  ? null
                  : 'agreement_not_pushable';
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
                      {/* THE SAME EIGHT CHARACTERS THE TABLET'S FOOTER SHOWS. */}
                      {session && (
                        <>
                          {' · '}
                          <SessionTag id={session.id} testId={`tablet-session-id-${device.id}`} />
                        </>
                      )}
                    </p>
                    {session && (
                      <p className={styles.cardSub}>
                        {strings.tablet.pushedAt(session.pushedBy, when(session.pushedAt))}
                      </p>
                    )}
                    {/*
                      WHAT IT LAST DID, on a tablet that is now idle. A name
                      and an ending — still a status, not a mirror.
                    */}
                    {ended && (
                      <p className={styles.cardSub} data-testid={`tablet-last-${device.id}`}>
                        {strings.tablet.tabletLastSession(
                          ended.patientName,
                          strings.tablet.states[ended.state] ?? ended.state,
                        )}
                        {' · '}
                        <SessionTag id={ended.id} testId={`tablet-last-session-id-${device.id}`} />
                      </p>
                    )}
                  </div>
                  <div className={styles.cardAside}>
                    <Chip tone={session ? (STATE_TONE[session.state] ?? 'neutral') : 'ok'}>
                      {session ? (strings.tablet.states[session.state] ?? session.state) : strings.tablet.tabletIdle}
                    </Chip>
                  </div>
                </div>

                {/*
                  WHAT THE PATIENT SAID IS WRONG (Carl, 4 Sep 2026). TYPES, in
                  our words — "Patient says wrong: address, mobile" — and never
                  the values, which stay off a screen that faces the room and
                  refreshes every three seconds. The values arrive when
                  somebody opens Correct, and go again when they close it.
                */}
                {session && session.disputedDetails.length > 0 && (
                  <Notice
                    tone="stop"
                    title={strings.tablet.disputedTitle}
                    data-testid={`disputed-${session.id}`}
                  >
                    <p>{strings.tablet.disputedList(disputedLabels(session.disputedDetails))}</p>
                    <p className={ui.hint}>{strings.tablet.disputedLead}</p>
                    {/*
                      SAID ONCE, BESIDE THE CHOICE. "No change needed" is a
                      claim somebody may be asked about later, so the screen
                      states that it is recorded and against whom before
                      anybody presses it.
                    */}
                    <p className={ui.hint} data-testid={`no-change-note-${session.id}`}>
                      {strings.tablet.noChangeNote}
                    </p>
                  </Notice>
                )}

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
                      onClick={() => void recall(session.id)}
                      data-testid={`recall-${session.id}`}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      {busyId === session.id ? strings.tablet.recalling : strings.tablet.recallAction}
                    </Button>

                    {session.disputedDetails.length > 0 && (
                      <>
                        <Button
                          disabled={!canSend || correctBusy}
                          onClick={() => {
                            if (correctFor === session.id) {
                              setCorrectFor(null);
                              setDetails(null);
                              setDraft({});
                              return;
                            }
                            void openCorrect(session);
                          }}
                          data-testid={`correct-open-${session.id}`}
                        >
                          <PencilLine size={14} aria-hidden="true" />
                          {correctFor === session.id
                            ? strings.tablet.correctClose
                            : strings.tablet.correctAction}
                        </Button>
                        {/*
                          RE-SEND IS RECALL + PUSH, and the server does both.
                          It re-reads the patient, so the corrected detail is
                          what the patient sees; and if a PARTICULAR changed on
                          a locked agreement it supersedes rather than edits
                          (HARD-02) and says so, which is why the outcome below
                          has two sentences.
                        */}
                        {/*
                          THE SECOND WAY OUT OF A DISPUTE (Carl, 4 Sep 2026):
                          the patient crossed a row that was RIGHT. Without
                          it, reception's only exit was to "correct" a detail
                          needing no correction — an event in the vault
                          claiming a change nobody made. This records what
                          actually happened, against the person who says so,
                          and changes nothing.
                        */}
                        <Button
                          disabled={!canSend || correctBusy || busyId !== null}
                          onClick={() => void noChangeNeeded(session)}
                          data-testid={`no-change-${session.id}`}
                        >
                          <CheckCheck size={14} aria-hidden="true" />
                          {strings.tablet.noChangeAction}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!canSend || busyId !== null}
                          onClick={() => void resend(session)}
                          data-testid={`resend-${session.id}`}
                        >
                          <Send size={14} aria-hidden="true" />
                          {busyId === session.id ? strings.tablet.resending : strings.tablet.resendAction}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/*
                  SEND IT AGAIN, ON THE ROW THAT SAID IT ENDED (Carl, 4 Sep
                  2026). The endings that reach here — walked away, timed out,
                  recalled, expired — changed NOTHING on the agreement (hard
                  rule 8, REQ-REC-04), so this is an ordinary push of the same
                  agreement to the same tablet. Dead until it could actually
                  go, with the same refusal mapping as every other push.
                */}
                {ended && (
                  <div className={styles.cardActions}>
                    <Button
                      variant="primary"
                      disabled={!canSend || busyId !== null || againBlocked !== null}
                      title={
                        againBlocked
                          ? blockedMessage(againBlocked, { providerType: againRow?.providerType })
                          : strings.tablet.sendAgainTitle
                      }
                      onClick={() => void sendAgain(ended)}
                      data-testid={`send-again-${ended.id}`}
                    >
                      <Send size={14} aria-hidden="true" />
                      {busyId === ended.id ? strings.tablet.sending : strings.tablet.sendAgainAction}
                    </Button>
                  </div>
                )}

                {ended && againBlocked && (
                  <Notice
                    tone="warn"
                    title={strings.tablet.sendBlocked}
                    data-testid={`send-again-blocked-${ended.id}`}
                  >
                    <RefusalOutcomeBody
                      info={describeRefusal(againBlocked, { providerType: againRow?.providerType })}
                      canSend={canSend}
                      busy={busyId !== null}
                      onRecall={(sessionId) => void recall(sessionId)}
                      linkTestId={`send-again-link-${ended.id}`}
                      recallTestId={`send-again-recall-${ended.id}`}
                      fix={
                        againBlocked === 'service_description_missing' && againRow
                          ? d6aFix(againRow)
                          : undefined
                      }
                    />
                  </Notice>
                )}

                {/*
                  THE CORRECTION PANEL — every detail, with the crossed ones
                  MARKED (Carl, 4 Sep 2026: "just in case the patient says my
                  mobile is also wrong but I ticked yes").

                  IT SHOWED ONLY THE CROSSED ROWS UNTIL TODAY, and that was
                  the wrong shape by one conversation: a person answering five
                  rows on a tablet ticks along and mentions the rest across
                  the desk, and reception then had to close this panel and go
                  looking for another screen. Showing all five and MARKING the
                  crossed ones keeps what the tablet reported without hiding
                  what the patient just said. Only what actually changes is
                  sent, so an untouched field never becomes a correction event.

                  AND CARL'S CAVEAT SITS ON IT, VERBATIM. The PMS is the source
                  of truth (REQ-DATA-10) and until the Medtech write-back
                  exists (D-01) nothing carries this correction home, so the
                  sentence is in front of the person typing rather than in a
                  help page they will not open.
                */}
                {session && correctFor === session.id && (
                  <div className={styles.form} data-testid={`correct-panel-${session.id}`}>
                    <p className={ui.hint}>{strings.tablet.correctHeading}</p>
                    <p className={ui.hint}>{strings.tablet.correctAllLead}</p>
                    <Notice
                      tone="warn"
                      title={strings.tablet.correctAction}
                      data-testid={`correct-caveat-${session.id}`}
                    >
                      {strings.tablet.correctPmsCaveat}
                    </Notice>
                    {details === null ? (
                      <p className={ui.hint}>{strings.tablet.correctLoading}</p>
                    ) : (
                      <>
                        {details.detailsCorrectedAt && (
                          <p className={ui.hint} data-testid={`corrected-at-${session.id}`}>
                            {strings.tablet.correctedAt(when(details.detailsCorrectedAt))}
                          </p>
                        )}
                        {CORRECTABLE_PATIENT_FIELDS.map((field) => {
                          // MARKED, NOT FILTERED. `fieldsToCorrect` maps the
                          // crossed TYPES onto the columns that answer them —
                          // a crossed "Name" marks both name columns, because
                          // a person does not read their name as two
                          // questions.
                          const disputed = fieldsToCorrect(session.disputedDetails).includes(field);
                          return (
                            <div
                              key={field}
                              className={disputed ? rowStyles.disputedField : undefined}
                              data-disputed={disputed ? 'true' : 'false'}
                              data-testid={`correct-field-${field}-${session.id}`}
                            >
                              <Field
                                label={strings.tablet.correctFields[field] ?? field}
                                hint={disputed ? strings.tablet.correctDisputedTag : undefined}
                              >
                                {(p) => (
                                  <TextInput
                                    {...p}
                                    type={field === 'dateOfBirth' ? 'date' : 'text'}
                                    value={draft[field] ?? ''}
                                    maxLength={field === 'address' ? 500 : 254}
                                    onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                                    data-testid={`correct-${field}-${session.id}`}
                                  />
                                )}
                              </Field>
                            </div>
                          );
                        })}
                        <div className={styles.formActions}>
                          <Button
                            variant="primary"
                            disabled={!canSend || correctBusy}
                            onClick={() => void saveCorrection(session)}
                            data-testid={`correct-save-${session.id}`}
                          >
                            {correctBusy ? strings.tablet.correctSaving : strings.tablet.correctSave}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {session && correctOutcome?.id === session.id && (
                  <Notice
                    tone={correctOutcome.ok ? 'ok' : 'stop'}
                    title={strings.tablet.correctAction}
                    data-testid={`correct-outcome-${device.id}`}
                  >
                    {correctOutcome.text}
                  </Notice>
                )}

                {outcome && (
                  <Notice
                    tone={outcome.ok ? 'ok' : 'stop'}
                    title={strings.tablet.recallAction}
                    data-testid={`recall-outcome-${device.id}`}
                  >
                    {outcome.info ? (
                      <RefusalOutcomeBody
                        info={outcome.info}
                        canSend={canSend}
                        busy={busyId !== null}
                        onRecall={(sessionId) => void recall(sessionId)}
                        linkTestId={`recall-outcome-link-${device.id}`}
                        recallTestId={`recall-outcome-recall-${device.id}`}
                      />
                    ) : (
                      outcome.text
                    )}
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
