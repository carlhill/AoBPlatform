'use client';

/**
 * THE PUSH DESK — the one implementation of reception's tablet controls,
 * rendered by two pages (Carl, 4 Sep 2026).
 *
 * WHY IT WAS PULLED OUT OF `TabletView`. `/practice/tablet` answers "what are
 * my tablets doing"; `/practice/patients/<id>` answers "what is open for the
 * person standing in front of me". They are different questions and they are
 * the SAME controls: send to a tablet, watch the state, recall, correct a
 * detail the patient crossed, say no change was needed, re-send, send again —
 * with the same refusal mapping and the same dead-until-valid rules. A second
 * copy of that on the patient page would be a second place for a rule to be
 * fixed, and the copy nobody remembered would be the one a practice met.
 *
 * A HOOK PLUS COMPONENTS, RATHER THAN PROPS THREADED THROUGH TEN LAYERS. The
 * hook owns the polling, the fetches and the outcome state; each component
 * takes the desk and the one row or session it draws. Both pages therefore
 * render byte-identical controls for identical data, which is what the named
 * test `work_page_tablet_controls_match_tablet_page` pins.
 *
 * EVERY RULE THAT LIVED IN `TabletView` STILL LIVES HERE, UNCHANGED — the
 * server's reason codes rendered in our own words (REQ-LANG-01), the domain's
 * own guards imported rather than re-typed, a status and never a mirror of the
 * tablet's screen, no Medicare number anywhere (hard rule 1) and no amount
 * anywhere (hard rule 4). The doc comments that explain WHY have moved with
 * the code they explain.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCheck, PencilLine, RotateCcw, Send, UserRound } from 'lucide-react';
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
  SelectInput,
  TextInput,
  ui,
  type Tone,
} from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import { toViewPath } from '../../viewPath';
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
export const POLL_MS = 3000;

export interface PushableRow {
  agreementId: string;
  agreementType: string;
  status: string;
  patientName: string;
  /** An id, not a detail — it is what lets a row be followed to its patient. */
  patientId: string;
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

export const STATE_TONE: Record<string, Tone> = {
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
export function SessionTag({ id, testId }: { id: string; testId: string }) {
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
 * A LINK ONLY WHERE ONE EXISTS. `agreement_not_pushable` has no page of its
 * own yet — no `/practice/agreements/:id` exists in this app — so it still
 * links to the reconciliation screen (the closest real place to look).
 * `patient_confidential` now has somewhere to go: the patient's own work page,
 * which is where the flag is visible and where the rest of their record is.
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

/** What only the caller knows at the moment of a refusal. See `describeRefusal`. */
export interface RefusalContext {
  deviceLabel?: string;
  patientName?: string;
  sessionId?: string;
  providerType?: string | null;
  rawMessage?: string;
  /** So `patient_confidential` can land on the patient it is about. */
  patientId?: string;
  /**
   * WHO IS LOOKING, so a link goes where THEY can actually open it (Carl,
   * 5 Sep 2026). Omitted, every link renders as the plain practice path it
   * always did — which is what `blockedMessage` and the copy tests ask for,
   * since neither is rendering a link at all.
   */
  audiences?: readonly Audience[];
  /** The practice the page is about, for the read-only twin's path. */
  practiceId?: string;
}

/**
 * ONE LINK, ROUTED THE WAY EVERY OTHER CONSOLE LINK IS ROUTED (Carl, 5 Sep
 * 2026) — `mayReach` decides whether to offer it at all, and `toViewPath`
 * rewrites it for a platform operator who is looking rather than acting. The
 * same pair `ChannelsView` and `SetupHub` already use, called from ONE place
 * here so a destination added to the refusal mapping later cannot forget the
 * twin (the failure `viewPath.ts` itself was written after).
 *
 * A LINK IS HIDDEN, NEVER LEFT TO 404. Offering somebody a way out that
 * refuses them is worse than the band saying only the sentence — which is why
 * the sentence always states what to do in words as well.
 */
function destination(
  path: string,
  label: string,
  ctx: Pick<RefusalContext, 'audiences' | 'practiceId'>,
  hash = '',
): RefusalDescription['link'] {
  if (!ctx.audiences) return { href: `${path}${hash}`, label };
  const actingAsPractice = ctx.audiences.includes('practice');
  // `canOpen`, computed as `ChannelsView` and `SetupHub` compute it: somebody
  // acting AS the practice is held to the page table; somebody looking is not,
  // because what they are offered is the read-only twin rather than this path.
  if (actingAsPractice && !mayReach(path, ctx.audiences)) return undefined;
  /*
   * AND THE TWIN EXISTS FOR A PLATFORM OPERATOR AND FOR NOBODY ELSE. A caller
   * we cannot place at all keeps the practice path — there is no practice they
   * are operating, and this page has already refused them by the time they
   * could read a band (`canSend` is false and every control is dead).
   */
  const operator = !actingAsPractice && ctx.audiences.includes('platform');
  const href = operator && ctx.practiceId ? toViewPath(path, ctx.practiceId) : path;
  return { href: `${href}${hash}`, label };
}

/**
 * WHY THE PUSH WAS REFUSED, in our words, with somewhere to go.
 *
 * `ctx` carries what only the CALLER knows at the moment of a refusal — which
 * tablet was chosen, who is on it right now, the row's own provider type and,
 * since the work page exists, which patient the row is about — never guessed
 * at here. A code this build has not met yet still renders with the raw CODE
 * on screen (`other`), never a sentence that sends reception looking for "the
 * practice queue".
 */
export function describeRefusal(
  reason: string | null | undefined,
  ctx: RefusalContext = {},
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
        link: destination('/practice/reconciliation', strings.tablet.toReconciliationForD6a, ctx),
      };
    case 'agreement_not_pushable':
      return {
        reason,
        text: strings.tablet.blocked.agreement_not_pushable,
        link: destination('/practice/reconciliation', strings.tablet.toReconciliationRow, ctx),
      };
    case 'device_revoked':
      return {
        reason,
        text: strings.tablet.blocked.device_revoked,
        link: destination('/practice/devices', strings.tablet.toDevices, ctx),
      };
    case 'device_not_paired':
      return {
        reason,
        text: strings.tablet.blocked.device_not_paired,
        link: destination('/practice/devices', strings.tablet.toDevices, ctx),
      };
    /*
     * RECEPTION'S OWN SWITCH, AND THE LINK LANDS WHERE IT IS UNSWITCHED (Carl,
     * 4–5 Sep 2026; CLAUDE.md §7 "shortcuts to the answer, not directions to a
     * screen"). Unlike a revoke this needs no administrator and no new pairing
     * code — one press on the page this link opens.
     */
    case 'device_out_of_use':
      return {
        reason,
        text: strings.tablet.blocked.device_out_of_use,
        link: destination('/practice/devices', strings.tablet.toDevices, ctx),
      };
    /*
     * THREE ENDURING REFUSALS NOW, AND THE DIFFERENCE MATTERS TO THE PERSON
     * READING (Carl, 4 Sep 2026; GA-PLAN B5 -- they replace the single
     * `enduring_not_supported`).
     *
     * `enduring_rules_not_authored` is PENDING: the platform is waiting on the
     * s 65C rule set's enduring branch, which is human-authored (CLAUDE.md
     * section 7). It will change.
     *
     * `enduring_not_gp` and `enduring_not_per_provider` are PERMANENT (hard
     * rule 6, REQ-END-01/-01a). Nothing is coming that will make an ongoing
     * agreement available for a specialist, and telling somebody to wait for
     * it would be sending them to wait for something that will never arrive.
     *
     * ALL THREE SAY WHAT TO DO INSTEAD, in the same breath.
     *
     * AND THE PENDING ONE NOW CARRIES BOTH THINGS RECEPTION CAN ACTUALLY DO
     * (Carl, 5 Sep 2026; CLAUDE.md §7, second instance). It used to carry
     * neither, on the reasoning that there is no rule-set screen in this
     * console to point at and a link that 404s is worse than none — true about
     * the rule set, and the wrong conclusion about the band. Nobody at a
     * practice can author a rule set. What they CAN do is get this patient an
     * agreement for today's visit, which is the button in the band
     * (`EnduringOfferFix`), and stop the practice drafting ongoing agreements
     * until the rule set exists, which is the Kiosk card's "offer an ongoing
     * agreement first" setting — a real screen, so a real link.
     *
     * `enduring_not_gp` AND `enduring_not_per_provider` STILL CARRY NEITHER,
     * and correctly: they are permanent (hard rule 6, REQ-END-01/-01a), so
     * there is nothing to wait for and no setting that changes them.
     */
    case 'enduring_rules_not_authored':
      return {
        reason,
        text: strings.tablet.blocked.enduring_rules_not_authored,
        // THE ANCHOR IS PART OF THE DESTINATION, not decoration: `#kiosk` lands
        // on the card that holds the setting rather than at the top of a page
        // with four cards on it.
        link: destination('/practice/channels', strings.tablet.toChannelsForOffer, ctx, '#kiosk'),
      };
    /*
     * THE BILLING ROLE (Carl, 5-7 Sep 2026). Unlike the enduring pair below
     * this one is FIXABLE, and by the person reading it: the role lives on the
     * affiliation and the practice sets it. So it carries a destination, and
     * the destination is the screen where it is changed -- not the queue, and
     * not a sentence telling somebody to go and look (Carl, 4 Sep 2026).
     */
    case 'provider_not_servicing':
      return {
        reason,
        text: strings.tablet.blocked.provider_not_servicing,
        link: destination('/practice/affiliations', strings.tablet.toAffiliations, ctx),
      };
    case 'enduring_not_gp':
      return {
        reason,
        text: `${strings.tablet.blocked.enduring_not_gp} ${strings.tablet.enduringOfferOther}`,
      };
    case 'enduring_not_per_provider':
      return { reason, text: strings.tablet.blocked.enduring_not_per_provider };
    case 'who_is_signing_unset':
      return { reason, text: strings.tablet.blocked.who_is_signing_unset };
    case 'patient_confidential':
      /*
       * IT HAS A DESTINATION NOW (Carl, 4 Sep 2026 — "shortcuts to the answer,
       * not directions to a screen"). Until the work page existed there was no
       * per-patient page in this app and the band carried no link on purpose,
       * rather than one that would 404. There is one, so it points at it — and
       * only when the caller actually knows which patient, which the tablet
       * page's own blocked rows now do.
       */
      return {
        reason,
        text: strings.tablet.blocked.patient_confidential,
        link: ctx.patientId
          ? destination(`/practice/patients/${ctx.patientId}`, strings.tablet.toPatient, ctx)
          : undefined,
      };
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

export function when(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * ONE REFUSAL, RENDERED — the sentence, and whatever the reason carries: a
 * link (`service_description_missing`, `agreement_not_pushable`,
 * `device_revoked`, `device_not_paired`, `patient_confidential`) or a Recall
 * button right in the band (`device_busy`). Shared between the row's own
 * outcome band and the tablet card's, so a busy refusal met from either
 * control (Send or Re-send) reads and behaves the same way.
 */
export function RefusalOutcomeBody({
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

// ---------------------------------------------------------------------------
// The desk itself
// ---------------------------------------------------------------------------

/**
 * WHAT ONE CORRECTION IS ABOUT.
 *
 * A CROSS ON A TABLET IS THE COMMON CASE AND NOT THE ONLY ONE (Carl, 4 Sep
 * 2026). Reception corrects a detail because the patient crossed it on the
 * screen -- and also because the patient mentioned it across the desk with no
 * tablet involved at all. The first records HOW THE DISPUTE ENDED against the
 * session that raised it; the second has no dispute to end, and inventing one
 * would put a resolution in the vault for a cross nobody made.
 *
 * `key` IS THE PANEL'S IDENTITY, so two corrections cannot be open at once and
 * an outcome lands on the one that produced it. A session's key is its id --
 * which keeps every test id on `/practice/tablet` exactly what it was.
 */
export interface CorrectionSubject {
  key: string;
  patientId: string;
  /** The TYPES the patient crossed, if this answers a cross. Empty otherwise. */
  disputedDetails: readonly string[];
  /** The session whose cross this answers, so the resolution is recorded on it. */
  session?: TabletSessionRow;
}

/** A session, as the thing a correction is about. */
export function subjectForSession(session: TabletSessionRow): CorrectionSubject {
  return {
    key: session.id,
    patientId: session.patientId,
    disputedDetails: session.disputedDetails,
    session,
  };
}

/**
 * A patient with nothing on a tablet -- a correction with no dispute to close.
 *
 * `disputedDetails` IS STILL MEANINGFUL HERE, AND IT IS NOT A CROSS ON A
 * TABLET (Carl, 4 Sep 2026). A patient who pressed "ask the practice to correct
 * this" on their own page has named a detail exactly as a cross does, so the
 * work page passes the requested type through and the correction panel MARKS
 * that field -- the same marking, from a different door. What it does NOT do is
 * record a dispute resolution: there is no session and nobody crossed anything,
 * and inventing one would put a resolution in the vault for a cross that was
 * never made. The patient's request is closed on its own review task instead.
 */
export function subjectForPatient(patientId: string, disputedDetails: readonly string[] = []): CorrectionSubject {
  return { key: `patient:${patientId}`, patientId, disputedDetails };
}

export interface PushDesk {
  rows: PushableRow[] | null;
  devices: DeviceRow[] | null;
  sessions: TabletSessionRow[];
  staffNames: readonly string[];
  loadError: string | null;
  canSend: boolean;
  /**
   * WHO IS LOOKING AND WHICH PRACTICE THEY ARE LOOKING AT — passed into
   * `describeRefusal` so a band's link goes where THIS caller can open it
   * (Carl, 5 Sep 2026). Held on the desk rather than recomputed per row: one
   * answer to "may this account act", used by the controls and by the links.
   */
  audiences: readonly Audience[];
  practiceId: string;
  busyId: string | null;
  /** Live sessions by device, and the last ENDED one for a device with none. */
  sessionByDevice: Map<string, TabletSessionRow>;
  lastEndedByDevice: Map<string, TabletSessionRow>;
  paired: DeviceRow[];
  free: DeviceRow[];
  load: () => Promise<unknown>;
  recall: (sessionId: string) => Promise<void>;
  /**
   * THE PATIENT WOULD RATHER AGREE EACH VISIT — so offer them this one (Carl,
   * 4 Sep 2026; GA-PLAN B5). One press: a fresh agreement for today's visit
   * with the same provider and patient, sent to the same tablet.
   */
  offerEpisodic: (sessionId: string) => Promise<void>;
  /**
   * THE ONGOING AGREEMENT CANNOT BE ASKED FOR AT ALL — so ask for this visit
   * (Carl, 5 Sep 2026). The band's own control, not a session's: there is no
   * tablet and no patient standing at one, so the server drafts, carries the
   * practice's description of the service and opens the capture request, and
   * the new row appears on this list.
   */
  offerEpisodicInstead: (row: PushableRow) => Promise<void>;
  send: (row: PushableRow) => Promise<void>;
  sendAgain: (ended: TabletSessionRow) => Promise<void>;
  resend: (session: TabletSessionRow) => Promise<void>;
  noChangeNeeded: (session: TabletSessionRow) => Promise<void>;
  openCorrect: (subject: CorrectionSubject) => Promise<void>;
  closeCorrect: () => void;
  saveCorrection: (subject: CorrectionSubject) => Promise<void>;
  correctFor: string | null;
  details: PatientDetails | null;
  draft: Partial<Record<CorrectablePatientField, string>>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<Record<CorrectablePatientField, string>>>>;
  correctBusy: boolean;
  correctOutcome: { id: string; text: string; ok: boolean } | null;
  target: Record<string, string>;
  setTarget: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pushOutcome: { id: string; ok: boolean; text?: string; info?: RefusalDescription } | null;
  whoFor: string | null;
  who: WhoDraft;
  setWho: React.Dispatch<React.SetStateAction<WhoDraft>>;
  whoBusy: boolean;
  whoOutcome: { id: string; text: string; ok: boolean } | null;
  openWho: (row: PushableRow) => void;
  closeWho: () => void;
  saveWho: (row: PushableRow) => Promise<void>;
  descriptions: { version: string; descriptions: string[] } | null;
  d6aChoice: Record<string, string>;
  setD6aChoice: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  d6aBusy: string | null;
  d6aOutcome: { id: string; text: string; ok: boolean } | null;
  setD6a: (row: PushableRow) => Promise<void>;
}

/**
 * EVERYTHING RECEPTION CAN DO TO A TABLET, IN ONE PLACE — the fetches, the
 * three-second poll, and the outcome of the last thing anybody pressed.
 *
 * IT POLLS. A poll, not a socket, for the reason §9.4 gives about the kiosk: a
 * dead socket fails silently and a poll fails visibly.
 */
export function usePushDesk(practiceId: string): PushDesk {
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
   * became busy on the server in the last few seconds — so the session that is
   * in the way is almost never in the array this closure already holds, and
   * re-reading it is the only honest way to name who is on the tablet rather
   * than fall back to `device_busySomeone`.
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
         * which the row reception is looking at has just vanished.
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
   * A POLL, NOT A SOCKET. `useRef` holds the latest `load` so the interval is
   * installed once rather than torn down and rebuilt on every render, which is
   * what turns a three-second poll into a burst.
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
         * carries the live session's id; the chosen tablet's own label is
         * already on this screen, and the patient on it is found from the
         * sessions this page already polls — the session id first, the device
         * id as a fallback if the id it named is not one we hold.
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
            patientId: row.patientId,
            audiences,
            practiceId,
          }),
        });
        return;
      }
      await load();
    } catch (e) {
      setPushOutcome({
        id: row.agreementId,
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
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
  async function openCorrect(subject: CorrectionSubject) {
    setCorrectOutcome(null);
    setCorrectFor(subject.key);
    setDetails(null);
    setDraft({});
    try {
      const res = await fetch(`${CORE_URL}/patients/${subject.patientId}/details`, {
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
        id: subject.key,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    }
  }

  function closeCorrect() {
    setCorrectFor(null);
    setDetails(null);
    setDraft({});
  }

  /**
   * SAVE THE CORRECTION. Only the fields reception actually changed are sent —
   * the server records one `patient.details_corrected` event per changed
   * field, with the TYPE and the staff member and never the value, and a
   * request full of unchanged fields would put events in the vault saying
   * somebody changed something when nobody did.
   */
  async function saveCorrection(subject: CorrectionSubject) {
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
      setCorrectOutcome({ id: subject.key, text: strings.tablet.correctNoChange, ok: false });
      return;
    }

    setCorrectBusy(true);
    setCorrectOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/patients/${subject.patientId}/details`, {
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
       * unconnected facts.
       */
      const changedTypes = [
        ...new Set(
          Object.keys(body)
            .filter(isCorrectablePatientField)
            .map((field) => detailTypeForPatientField(field)),
        ),
      ];
      /*
       * ONLY WHERE THERE IS A CROSS TO CLOSE. A correction made because the
       * patient mentioned it at the desk has no dispute behind it, and
       * recording a resolution for one would claim an answer to a question
       * nobody asked.
       */
      const recorded = subject.session
        ? await recordResolution(subject.session, 'corrected', changedTypes)
        : true;
      setCorrectOutcome({
        id: subject.key,
        text: recorded ? strings.tablet.correctSaved : strings.tablet.resolveNotRecorded,
        ok: recorded,
      });
      setCorrectFor(null);
      setDetails(null);
      setDraft({});
      await load();
    } catch (e) {
      setCorrectOutcome({
        id: subject.key,
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
   * been saved and reception must not be told it was not.
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
   * THE SAME ENDPOINT THE RECONCILIATION SCREEN USES, unchanged. This adds a
   * second place to press it, not a second way of doing it — and it
   * deliberately does NOT lock, for the reason `ServiceDescriptionsService`
   * gives at length.
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
      // engine or the versioned list speaking.
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
   * SAME call the row's own Send makes.
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
            patientId: ended.patientId,
            audiences,
            practiceId,
          }),
        });
        return;
      }
      await load();
    } catch (e) {
      setPushOutcome({
        id: ended.id,
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
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
            patientId: session.patientId,
            audiences,
            practiceId,
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
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
      });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * THE ONE PRESS THAT ANSWERS A DECLINED ONGOING AGREEMENT (Carl, 4 Sep
   * 2026). It is the SERVER'S act end to end — create the draft, carry the
   * description of the service, push it — because every part of that is
   * evidence and none of it may be assembled by a screen.
   *
   * IT REFUSES THE SAME WAY THE PUSH DOES, and lands in the same outcome band
   * on the same row, so a description that is not set or a tablet somebody
   * else grabbed reads exactly as it does on every other send.
   */
  async function offerEpisodic(sessionId: string) {
    setBusyId(sessionId);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/tablet-sessions/${sessionId}/offer-episodic`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const info = await refusal(res);
        setPushOutcome({ id: sessionId, ok: false, text: info.message, info: describeRefusal(info.reason, {
          rawMessage: info.message,
          audiences,
          practiceId,
        }) });
        return;
      }
      setPushOutcome({ id: sessionId, ok: true, text: strings.tablet.offerEpisodicDone });
      await load();
    } catch (e) {
      setPushOutcome({
        id: sessionId,
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
      });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * "CREATE AN AGREEMENT FOR THIS VISIT INSTEAD" — pressed on the band that
   * says the enduring rule set is awaiting authoring (Carl, 5 Sep 2026).
   *
   * IT IS THE SERVER'S ACT END TO END, exactly as the declined-session offer
   * is: the draft, the description of the service, the lock and the capture
   * request are every one of them evidence, and none may be assembled by a
   * screen. This posts, then re-reads — the new episodic row appears (pushable
   * where the description was there to lock) and the enduring row leaves the
   * list, which is the honest way to show that both happened.
   *
   * THE OUTCOME LANDS ON THE ENDURING ROW that was pressed, because that is
   * the row somebody is looking at. It is gone on the next poll, and what
   * replaces it is the new row a line below.
   */
  async function offerEpisodicInstead(row: PushableRow) {
    setBusyId(row.agreementId);
    setPushOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/agreements/${row.agreementId}/offer-episodic`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const { reason, message } = await refusal(res);
        setPushOutcome({
          id: row.agreementId,
          ok: false,
          info: describeRefusal(reason, {
            providerType: row.providerType,
            patientId: row.patientId,
            rawMessage: message,
            audiences,
            practiceId,
          }),
        });
        return;
      }
      setPushOutcome({ id: row.agreementId, ok: true, text: strings.tablet.offerEpisodicInsteadDone });
      await load();
    } catch (e) {
      setPushOutcome({
        id: row.agreementId,
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
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
        ok: false,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
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

  const paired = (devices ?? []).filter((d) => d.state !== 'revoked');
  const free = paired.filter((d) => d.state === 'paired' && !sessionByDevice.has(d.id));

  return {
    rows,
    devices,
    sessions,
    staffNames,
    loadError,
    canSend,
    audiences,
    practiceId,
    busyId,
    sessionByDevice,
    lastEndedByDevice,
    paired,
    free,
    load,
    recall,
    offerEpisodic,
    offerEpisodicInstead,
    send,
    sendAgain,
    resend,
    noChangeNeeded,
    openCorrect,
    closeCorrect,
    saveCorrection,
    correctFor,
    details,
    draft,
    setDraft,
    correctBusy,
    correctOutcome,
    target,
    setTarget,
    pushOutcome,
    whoFor,
    who,
    setWho,
    whoBusy,
    whoOutcome,
    openWho,
    closeWho: () => setWhoFor(null),
    saveWho,
    descriptions,
    d6aChoice,
    setD6aChoice,
    d6aBusy,
    d6aOutcome,
    setD6a,
  };
}

// ---------------------------------------------------------------------------
// The controls, rendered
// ---------------------------------------------------------------------------

/**
 * THE FIX, IN THE BAND THAT STATES THE PROBLEM (Carl, 4 Sep 2026). The one
 * thing standing between this patient and the tablet is a description of the
 * service, and the control that supplies it belongs here rather than two
 * screens away — "shortcuts to the answer, not directions to a screen"
 * (CLAUDE.md §7).
 *
 * THE WORDS COME FROM THE SERVER AND THE VERSION IS SHOWN. They are the exact
 * strings the rules engine matches and they are versioned content (hard rule
 * 14); a list in this file would be a second copy that goes stale silently, so
 * this component knows none of them and says which list it is offering.
 */
export function D6aFix({ desk, row }: { desk: PushDesk; row: PushableRow }) {
  const said = desk.d6aOutcome?.id === row.agreementId ? desk.d6aOutcome : null;
  return (
    <div className={rowStyles.fix} data-testid={`d6a-fix-${row.agreementId}`}>
      {desk.descriptions && (
        <Chip tone="neutral">{strings.tablet.d6aListVersion(desk.descriptions.version)}</Chip>
      )}
      <Field label={strings.tablet.d6aSetLabel}>
        {(p) => (
          <SelectInput
            {...p}
            value={desk.d6aChoice[row.agreementId] ?? ''}
            disabled={!desk.canSend || !desk.descriptions || desk.d6aBusy !== null}
            onChange={(e) => desk.setD6aChoice((c) => ({ ...c, [row.agreementId]: e.target.value }))}
            data-testid={`d6a-select-${row.agreementId}`}
          >
            <option value="">{strings.tablet.d6aSetPlaceholder}</option>
            {/* IN THE ORDER THE SERVER SENT. File order is screen order. */}
            {(desk.descriptions?.descriptions ?? []).map((description) => (
              <option key={description} value={description}>
                {description}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <div className={styles.formActions}>
        <Button
          onClick={() => void desk.setD6a(row)}
          disabled={!desk.canSend || desk.d6aBusy !== null || !desk.d6aChoice[row.agreementId]}
          data-testid={`d6a-set-${row.agreementId}`}
        >
          {desk.d6aBusy === row.agreementId ? strings.tablet.d6aSetting : strings.tablet.d6aSetAction}
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

/**
 * THE OTHER FIX IN A BAND, AND THE ONE RECEPTION COULD NOT MAKE AT ALL (Carl,
 * 5 Sep 2026; CLAUDE.md §7 "shortcuts to the answer", second instance).
 *
 * The band said the enduring rule set is awaiting authoring and stopped there.
 * Authoring it is a human-authored zone (CLAUDE.md §7) and no receptionist can
 * do it — so the band offered a person standing in front of a patient nothing
 * at all. This is the thing they CAN do: one press, and the same patient has
 * an agreement for today's visit with the same provider, on today's list and
 * ready for a tablet.
 *
 * ONE PRESS, ONE SERVER ACT. The draft, the description of the service, the
 * lock and the capture request are the server's — a screen that assembled an
 * agreement would be a screen asserting a contract (the same reasoning
 * `OfferEpisodic` carries for the declined case, whose drafting this shares).
 *
 * NOTHING HERE BLOCKS CARE. Whether it goes or not, the patient is seen (hard
 * rule 8, REQ-REC-04) — and the sentence above the button says so.
 */
export function EnduringOfferFix({ desk, row }: { desk: PushDesk; row: PushableRow }) {
  return (
    <div className={rowStyles.fix} data-testid={`enduring-offer-fix-${row.agreementId}`}>
      <div className={styles.formActions}>
        <Button
          variant="primary"
          disabled={!desk.canSend || desk.busyId !== null}
          onClick={() => void desk.offerEpisodicInstead(row)}
          data-testid={`offer-episodic-instead-${row.agreementId}`}
        >
          <Send size={14} aria-hidden="true" />
          {desk.busyId === row.agreementId
            ? strings.tablet.offerEpisodicInsteadBusy
            : strings.tablet.offerEpisodicInsteadAction}
        </Button>
      </div>
    </div>
  );
}

/**
 * WHICH REASON HAS A CONTROL IN ITS OWN BAND — one mapping, so the row's
 * standing "cannot be sent" band and the band after a refused press cannot
 * come to offer different fixes for the same reason.
 */
function fixFor(desk: PushDesk, row: PushableRow, reason: string | null | undefined): ReactNode {
  if (reason === 'service_description_missing') return <D6aFix desk={desk} row={row} />;
  if (reason === 'enduring_rules_not_authored') return <EnduringOfferFix desk={desk} row={row} />;
  return undefined;
}

/**
 * ONE AGREEMENT WAITING TO BE SIGNED, WITH EVERY CONTROL THAT ACTS ON IT.
 *
 * Rendered identically by the tablet page's waiting list and by one patient's
 * work page, which is the whole reason it is a component: Send is dead until
 * the row can actually go, the reason it cannot is stated in a full-width band
 * with the fix in it, and who is signing is set at the DESK before the push
 * (D7 is explicit and never inferred, CLAUDE.md §3).
 *
 * `showPatientName` IS THE ONLY DIFFERENCE BETWEEN THE TWO PAGES. A list of
 * everybody waiting must say who each row is about; a page that is already
 * about one person, with their name at the top, does not repeat it on every
 * card.
 */
export function AgreementRow({
  desk,
  row,
  showPatientName = true,
  heading,
}: {
  desk: PushDesk;
  row: PushableRow;
  showPatientName?: boolean;
  /**
   * WHAT KIND OF AGREEMENT THIS IS, where the page is already about one person
   * and the name would be the wrong heading -- "Enduring · Dr Example
   * Provider", which is also where hard rule 6 is made visible: an enduring
   * agreement is named UNDER ITS PROVIDER, never as anything practice-wide.
   */
  heading?: string;
}) {
  const live = row.activeSession ? desk.sessions.find((s) => s.id === row.activeSession!.id) : undefined;
  const outcome = desk.pushOutcome?.id === row.agreementId ? desk.pushOutcome : null;
  const whoSaid = desk.whoOutcome?.id === row.agreementId ? desk.whoOutcome : null;
  const blocked = whoIsBlocked(desk.who, desk.staffNames);

  return (
    <li key={row.agreementId} className={rowStyles.row} data-testid={`pushable-${row.agreementId}`}>
      {/* WHO THIS IS. */}
      <div className={rowStyles.identity}>
        {showPatientName && <strong>{row.patientName}</strong>}
        {heading && <strong data-testid={`agreement-heading-${row.agreementId}`}>{heading}</strong>}
        {/*
          AN ONGOING AGREEMENT IS NAMED UNDER ITS PROVIDER (hard rule 6,
          REQ-END-01): "Ongoing agreement · Dr Example Provider", never
          anything that reads as practice-wide. And no appointment time,
          because a standing agreement is not about a booking -- printing
          "9:00" beside it would say the opposite of what it is.
        */}
        <div className={ui.hint} data-testid={`row-line-${row.agreementId}`}>
          {row.agreementType === 'enduring'
            ? row.providerName
              ? strings.tablet.enduringRow(row.providerName)
              : strings.tablet.enduringRowNoProvider
            : [row.providerName, whenLabel(row)].filter(Boolean).join(' · ')}
        </div>
        {live && (
          <Chip tone={STATE_TONE[live.state] ?? 'neutral'}>
            {strings.tablet.onTabletNow(live.deviceLabel)} ·{' '}
            <SessionTag id={live.id} testId={`row-session-id-${row.agreementId}`} />
          </Chip>
        )}
      </div>

      {/*
        WHAT THE VISIT IS. Label and value are rendered as ONE string each
        (`serviceFact` / `signingFact`) so there is nothing for a narrow column
        to split a fact across two lines.
      */}
      <div className={rowStyles.facts}>
        <p className={`${ui.hint} ${rowStyles.fact}`}>{serviceFact(row)}</p>
        <p className={`${ui.hint} ${rowStyles.fact}`}>{signingFact(row)}</p>
        {/*
          ENDURING IS GP-ONLY (hard rule 6). Where the provider is not a general
          practitioner the screen says what to offer instead — a Treatment Plan
          Assignment — rather than leaving somebody to discover that enduring is
          not on the menu.
        */}
        {row.agreementType === 'enduring' && row.providerType !== 'general_practitioner' && (
          <p
            className={`${ui.hint} ${rowStyles.fact}`}
            data-testid={`enduring-gp-only-${row.agreementId}`}
          >
            {strings.tablet.enduringGpOnly}
          </p>
        )}
      </div>

      {/*
        WHO IS SIGNING, SET AT THE DESK — before the push, never on the tablet.
      */}
      <div className={rowStyles.who}>
        <Button
          variant="subtle"
          disabled={!desk.canSend || row.particularsLocked}
          onClick={() => (desk.whoFor === row.agreementId ? desk.closeWho() : desk.openWho(row))}
          data-testid={`who-open-${row.agreementId}`}
        >
          <UserRound size={14} aria-hidden="true" />
          {desk.whoFor === row.agreementId ? strings.tablet.whoClose : strings.tablet.whoOpen}
        </Button>
      </div>

      {/*
        WHERE IT GOES. Send is dead until the row can actually go — a control
        that can only fail is a control that teaches people the page is broken
        (CLAUDE.md §6). Blocked, its title carries the reason as a tooltip; the
        reason itself is stated once, in the full-width band below.
      */}
      <div className={rowStyles.send}>
        <SelectInput
          id={`target-${row.agreementId}`}
          aria-label={strings.tablet.sendChoose}
          value={desk.target[row.agreementId] ?? ''}
          disabled={!desk.canSend || !row.pushable || desk.free.length === 0 || desk.busyId !== null}
          onChange={(e) => desk.setTarget((t) => ({ ...t, [row.agreementId]: e.target.value }))}
          data-testid={`target-${row.agreementId}`}
        >
          <option value="">{strings.tablet.sendChoose}</option>
          {desk.free.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </SelectInput>
        <Button
          variant="primary"
          disabled={
            !desk.canSend || !row.pushable || !desk.target[row.agreementId] || desk.busyId !== null
          }
          title={
            row.pushable ? undefined : blockedMessage(row.blockedReason, { providerType: row.providerType })
          }
          onClick={() => void desk.send(row)}
          data-testid={`send-${row.agreementId}`}
        >
          <Send size={14} aria-hidden="true" />
          {desk.busyId === row.agreementId
            ? strings.tablet.sending
            : row.pushable
              ? strings.tablet.sendAction
              : strings.tablet.sendBlocked}
        </Button>
      </div>

      {/*
        THE REASON IT CANNOT GO, on the row, always — never only after somebody
        presses something. This is Carl's live test made structural: reception
        must be able to see who needs fixing.
      */}
      {!row.pushable && (
        <div className={rowStyles.band}>
          <Notice tone="warn" title={strings.tablet.sendBlocked} data-testid={`blocked-${row.agreementId}`}>
            <RefusalOutcomeBody
              info={describeRefusal(row.blockedReason, {
                providerType: row.providerType,
                patientId: row.patientId,
                audiences: desk.audiences,
                practiceId: desk.practiceId,
              })}
              canSend={desk.canSend}
              busy={desk.busyId !== null}
              onRecall={(sessionId) => void desk.recall(sessionId)}
              linkTestId={`blocked-link-${row.agreementId}`}
              recallTestId={`blocked-recall-${row.agreementId}`}
              fix={fixFor(desk, row, row.blockedReason)}
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
              A REFUSAL WITH SOMEWHERE TO GO SHOWS IT, right here — never only a
              sentence (Carl, 4 Sep 2026). `device_busy` offers Recall inline,
              so pressing it re-enables Send without reception hunting the
              tablet down themselves.
            */}
            {outcome.info ? (
              <RefusalOutcomeBody
                info={outcome.info}
                canSend={desk.canSend}
                busy={desk.busyId !== null}
                onRecall={(sessionId) => void desk.recall(sessionId)}
                linkTestId={`push-outcome-link-${row.agreementId}`}
                recallTestId={`push-outcome-recall-${row.agreementId}`}
                fix={fixFor(desk, row, outcome.info.reason)}
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

      {desk.whoFor === row.agreementId && (
        <div className={`${styles.cardBody} ${rowStyles.band}`} data-testid={`who-panel-${row.agreementId}`}>
          <Checkbox
            checked={desk.who.isPatient}
            onCheckedChange={(v) => desk.setWho((w) => ({ ...w, isPatient: v }))}
            label={strings.tablet.whoPatient}
          />
          {!desk.who.isPatient && (
            <>
              <p className={ui.hint}>{strings.tablet.whoOther}</p>
              <Field label={strings.tablet.whoName} required>
                {(p) => (
                  <TextInput
                    {...p}
                    value={desk.who.name}
                    maxLength={200}
                    onChange={(e) => desk.setWho((w) => ({ ...w, name: e.target.value }))}
                    data-testid={`who-name-${row.agreementId}`}
                  />
                )}
              </Field>
              <Field label={strings.tablet.whoRelationship} required>
                {(p) => (
                  <SelectInput
                    {...p}
                    value={desk.who.relationship}
                    onChange={(e) => desk.setWho((w) => ({ ...w, relationship: e.target.value }))}
                    data-testid={`who-relationship-${row.agreementId}`}
                  >
                    <option value="">{strings.tablet.whoRelationshipPlaceholder}</option>
                    {/*
                      THE OPTIONS AND THEIR ORDER COME FROM VERSIONED CONTENT
                      (hard rule 14), never from this file. Only the words are
                      in the string table, keyed by the content file's key.
                    */}
                    {ASSIGNOR_RELATIONSHIP_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {relationshipLabel(option.key)}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              {relationshipNeedsFreeText(desk.who.relationship) && (
                <Field label={strings.tablet.whoDescribe} required>
                  {(p) => (
                    <TextInput
                      {...p}
                      value={desk.who.describe}
                      maxLength={500}
                      onChange={(e) => desk.setWho((w) => ({ ...w, describe: e.target.value }))}
                      data-testid={`who-describe-${row.agreementId}`}
                    />
                  )}
                </Field>
              )}
              <Checkbox
                checked={desk.who.declaredOfAge}
                onCheckedChange={(v) => desk.setWho((w) => ({ ...w, declaredOfAge: v }))}
                // The threshold is imported, never typed here.
                label={strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER)}
              />
              <p className={ui.hint}>{strings.tablet.whoContactHint}</p>
              <Field label={strings.tablet.whoMobile}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={desk.who.mobile}
                    maxLength={30}
                    onChange={(e) => desk.setWho((w) => ({ ...w, mobile: e.target.value }))}
                    data-testid={`who-mobile-${row.agreementId}`}
                  />
                )}
              </Field>
              <Field label={strings.tablet.whoEmail}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={desk.who.email}
                    maxLength={254}
                    onChange={(e) => desk.setWho((w) => ({ ...w, email: e.target.value }))}
                    data-testid={`who-email-${row.agreementId}`}
                  />
                )}
              </Field>
            </>
          )}
          <div className={styles.formActions}>
            <Button
              variant="primary"
              disabled={!desk.canSend || desk.whoBusy || blocked !== null}
              onClick={() => void desk.saveWho(row)}
              data-testid={`who-save-${row.agreementId}`}
            >
              {desk.whoBusy ? strings.tablet.whoSaving : strings.tablet.whoSave}
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
}

/**
 * WHAT THE PATIENT SAID IS WRONG, AND WHETHER ANYBODY HAS ANSWERED IT.
 *
 * TYPES, IN OUR WORDS — "Patient says wrong: address, mobile" — and never the
 * values, which stay off a screen that faces the room and refreshes every
 * three seconds. The values arrive when somebody opens Correct, and go again
 * when they close it.
 */
export function SessionDisputeNotices({ session }: { session: TabletSessionRow }) {
  return (
    <>
      {/* BEFORE RECEPTION HAS ANSWERED: what the patient crossed. */}
      {session.disputedDetails.length > 0 && !session.disputeResolution && (
        <Notice tone="stop" title={strings.tablet.disputedTitle} data-testid={`disputed-${session.id}`}>
          <p>{strings.tablet.disputedList(disputedLabels(session.disputedDetails))}</p>
          <p className={ui.hint}>{strings.tablet.disputedLead}</p>
          {/*
            SAID ONCE, BESIDE THE CHOICE. "No change needed" is a claim somebody
            may be asked about later, so the screen states that it is recorded
            and against whom before anybody presses it.
          */}
          <p className={ui.hint} data-testid={`no-change-note-${session.id}`}>
            {strings.tablet.noChangeNote}
          </p>
        </Notice>
      )}

      {/*
        AFTER IT (Carl, 4 Sep 2026): the row stops repeating "a detail is wrong"
        at somebody who has already dealt with it, and says what is true now.
        IT STILL NAMES WHAT WAS CROSSED — reception may be a different person
        from the one who fixed it. TYPES, never values (REQ-VER-04).
      */}
      {session.disputeResolution && (
        <Notice tone="ok" title={strings.tablet.resolvedTitle} data-testid={`resolved-${session.id}`}>
          <p>
            {session.disputeResolution === 'corrected'
              ? strings.tablet.resolvedCorrected
              : strings.tablet.resolvedPatientError}
          </p>
          <p className={ui.hint} data-testid={`resolved-was-${session.id}`}>
            {strings.tablet.resolvedWas(disputedLabels(session.disputedDetails))}
            {session.disputeResolvedAt && (
              <>
                {' · '}
                {strings.tablet.resolvedAt(when(session.disputeResolvedAt))}
              </>
            )}
            {' · '}
            <SessionTag id={session.id} testId={`resolved-session-id-${session.id}`} />
          </p>
        </Notice>
      )}
    </>
  );
}

/**
 * WHAT RECEPTION CAN DO TO A LIVE SESSION: take the screen back, correct the
 * detail the patient crossed, say no change was needed, send it again.
 *
 * RECALL TAKES THE SCREEN BACK AND NOTHING ELSE. The agreement is untouched —
 * the patient can be handed the tablet again in a minute, sign by another
 * channel, or be billed privately (REQ-REC-04).
 */
export function SessionActions({ desk, session }: { desk: PushDesk; session: TabletSessionRow }) {
  const subject = subjectForSession(session);
  return (
    <div className={styles.cardActions}>
      <Button
        disabled={!desk.canSend || desk.busyId !== null}
        onClick={() => void desk.recall(session.id)}
        data-testid={`recall-${session.id}`}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {desk.busyId === session.id ? strings.tablet.recalling : strings.tablet.recallAction}
      </Button>

      {session.disputedDetails.length > 0 && (
        <>
          <Button
            disabled={!desk.canSend || desk.correctBusy}
            onClick={() => {
              if (desk.correctFor === subject.key) {
                desk.closeCorrect();
                return;
              }
              void desk.openCorrect(subject);
            }}
            data-testid={`correct-open-${session.id}`}
          >
            <PencilLine size={14} aria-hidden="true" />
            {desk.correctFor === session.id ? strings.tablet.correctClose : strings.tablet.correctAction}
          </Button>
          {/*
            THE SECOND WAY OUT OF A DISPUTE (Carl, 4 Sep 2026): the patient
            crossed a row that was RIGHT. It goes once the dispute is answered —
            pressing it on a resolved row would only overwrite one answer with
            another; Correct stays available for a second go.
          */}
          {!session.disputeResolution && (
            <Button
              disabled={!desk.canSend || desk.correctBusy || desk.busyId !== null}
              onClick={() => void desk.noChangeNeeded(session)}
              data-testid={`no-change-${session.id}`}
            >
              <CheckCheck size={14} aria-hidden="true" />
              {strings.tablet.noChangeAction}
            </Button>
          )}
          {/*
            RE-SEND IS RECALL + PUSH, and the server does both. It re-reads the
            patient, so the corrected detail is what the patient sees; and if a
            PARTICULAR changed on a locked agreement it supersedes rather than
            edits (HARD-02) and says so.
          */}
          <Button
            variant="primary"
            disabled={!desk.canSend || desk.busyId !== null}
            onClick={() => void desk.resend(session)}
            data-testid={`resend-${session.id}`}
          >
            <Send size={14} aria-hidden="true" />
            {desk.busyId === session.id ? strings.tablet.resending : strings.tablet.resendAction}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * THE CORRECTION PANEL — every detail, with the crossed ones MARKED (Carl, 4
 * Sep 2026: "just in case the patient says my mobile is also wrong but I ticked
 * yes").
 *
 * IT SHOWED ONLY THE CROSSED ROWS UNTIL TODAY, and that was the wrong shape by
 * one conversation: a person answering five rows on a tablet ticks along and
 * mentions the rest across the desk. Only what actually changes is sent, so an
 * untouched field never becomes a correction event.
 *
 * AND CARL'S CAVEAT SITS ON IT, VERBATIM. The PMS is the source of truth
 * (REQ-DATA-10) and until the Medtech write-back exists (D-01) nothing carries
 * this correction home, so the sentence is in front of the person typing.
 */
export function CorrectionPanel({ desk, subject }: { desk: PushDesk; subject: CorrectionSubject }) {
  if (desk.correctFor !== subject.key) return null;
  return (
    <div className={styles.form} data-testid={`correct-panel-${subject.key}`}>
      <p className={ui.hint}>{strings.tablet.correctHeading}</p>
      <p className={ui.hint}>{strings.tablet.correctAllLead}</p>
      <Notice tone="warn" title={strings.tablet.correctAction} data-testid={`correct-caveat-${subject.key}`}>
        {strings.tablet.correctPmsCaveat}
      </Notice>
      {desk.details === null ? (
        <p className={ui.hint}>{strings.tablet.correctLoading}</p>
      ) : (
        <>
          {desk.details.detailsCorrectedAt && (
            <p className={ui.hint} data-testid={`corrected-at-${subject.key}`}>
              {strings.tablet.correctedAt(when(desk.details.detailsCorrectedAt))}
            </p>
          )}
          {CORRECTABLE_PATIENT_FIELDS.map((field) => {
            // MARKED, NOT FILTERED. `fieldsToCorrect` maps the crossed TYPES
            // onto the columns that answer them — a crossed "Name" marks both
            // name columns, because a person does not read their name as two
            // questions.
            const disputed = fieldsToCorrect(subject.disputedDetails).includes(field);
            return (
              <div
                key={field}
                className={disputed ? rowStyles.disputedField : undefined}
                data-disputed={disputed ? 'true' : 'false'}
                data-testid={`correct-field-${field}-${subject.key}`}
              >
                <Field
                  label={strings.tablet.correctFields[field] ?? field}
                  hint={disputed ? strings.tablet.correctDisputedTag : undefined}
                >
                  {(p) => (
                    <TextInput
                      {...p}
                      type={field === 'dateOfBirth' ? 'date' : 'text'}
                      value={desk.draft[field] ?? ''}
                      maxLength={field === 'address' ? 500 : 254}
                      onChange={(e) => desk.setDraft((d) => ({ ...d, [field]: e.target.value }))}
                      data-testid={`correct-${field}-${subject.key}`}
                    />
                  )}
                </Field>
              </div>
            );
          })}
          <div className={styles.formActions}>
            <Button
              variant="primary"
              disabled={!desk.canSend || desk.correctBusy}
              onClick={() => void desk.saveCorrection(subject)}
              data-testid={`correct-save-${subject.key}`}
            >
              {desk.correctBusy ? strings.tablet.correctSaving : strings.tablet.correctSave}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * SEND IT AGAIN, ON THE ROW THAT SAID IT ENDED (Carl, 4 Sep 2026). The endings
 * that reach here — walked away, timed out, recalled, expired — changed NOTHING
 * on the agreement (hard rule 8, REQ-REC-04), so this is an ordinary push of
 * the same agreement to the same tablet. Dead until it could actually go, with
 * the same refusal mapping as every other push.
 */
export function SendAgain({ desk, ended }: { desk: PushDesk; ended: TabletSessionRow }) {
  /*
   * A DECLINED ONGOING AGREEMENT IS NOT A SEND-AGAIN (Carl, 4 Sep 2026;
   * GA-PLAN B5). The patient read that agreement and said they would rather be
   * asked each visit; handing them the same one back is the one thing they
   * have already answered. The right next act is a different agreement -- for
   * today's visit -- so this row carries THAT control instead.
   *
   * IT LIVES IN THIS SHARED COMPONENT, not on either page, so the tablet page
   * and the patient work page cannot come to offer different answers to the
   * same row (the reason every other control here is shared).
   */
  if (ended.state === 'declined_enduring') return <OfferEpisodic desk={desk} ended={ended} />;

  /*
   * WHETHER IT COULD ACTUALLY GO, read from the list this page already polls —
   * dead until valid (CLAUDE.md §6). An agreement no longer on the pushable
   * list has moved on: signed, superseded, or captured another way, which is
   * exactly what `agreement_not_pushable` says.
   */
  const againRow = (desk.rows ?? []).find((r) => r.agreementId === ended.agreementId);
  const againBlocked: string | null = againRow
    ? againRow.pushable
      ? null
      : (againRow.blockedReason ?? 'agreement_not_pushable')
    : desk.rows === null
      ? null
      : 'agreement_not_pushable';

  return (
    <>
      <div className={styles.cardActions}>
        <Button
          variant="primary"
          disabled={!desk.canSend || desk.busyId !== null || againBlocked !== null}
          title={
            againBlocked
              ? blockedMessage(againBlocked, { providerType: againRow?.providerType })
              : strings.tablet.sendAgainTitle
          }
          onClick={() => void desk.sendAgain(ended)}
          data-testid={`send-again-${ended.id}`}
        >
          <Send size={14} aria-hidden="true" />
          {desk.busyId === ended.id ? strings.tablet.sending : strings.tablet.sendAgainAction}
        </Button>
      </div>

      {againBlocked && (
        <Notice tone="warn" title={strings.tablet.sendBlocked} data-testid={`send-again-blocked-${ended.id}`}>
          <RefusalOutcomeBody
            info={describeRefusal(againBlocked, {
              providerType: againRow?.providerType,
              patientId: ended.patientId,
              audiences: desk.audiences,
              practiceId: desk.practiceId,
            })}
            canSend={desk.canSend}
            busy={desk.busyId !== null}
            onRecall={(sessionId) => void desk.recall(sessionId)}
            linkTestId={`send-again-link-${ended.id}`}
            recallTestId={`send-again-recall-${ended.id}`}
            fix={againRow ? fixFor(desk, againRow, againBlocked) : undefined}
          />
        </Notice>
      )}
    </>
  );
}

/**
 * "CREATE AGREEMENT FOR TODAY'S VISIT" — reception's one press after a patient
 * declines an ongoing agreement (Carl, 4 Sep 2026; GA-PLAN B5).
 *
 * SHORTCUTS TO THE ANSWER, NOT DIRECTIONS TO A SCREEN (CLAUDE.md section 7).
 * The row already says what happened; without this it would also have to say
 * "now go and make a different agreement somewhere else", which is the failure
 * that principle is named after. The server does the whole act -- draft, the
 * description of the service, push -- and refuses in exactly the same
 * vocabulary as every other send, so a description that is not set lands in
 * the band below with the inline fix reception already knows.
 *
 * NOTHING HERE BLOCKS CARE. If it cannot go, the draft is still on the list
 * with its reason on it and the patient is seen either way (hard rule 8,
 * REQ-REC-04).
 */
export function OfferEpisodic({ desk, ended }: { desk: PushDesk; ended: TabletSessionRow }) {
  return (
    <>
      <p className={ui.hint}>{strings.tablet.offerEpisodicLead}</p>
      <div className={styles.cardActions}>
        <Button
          variant="primary"
          disabled={!desk.canSend || desk.busyId !== null}
          onClick={() => void desk.offerEpisodic(ended.id)}
          data-testid={`offer-episodic-${ended.id}`}
        >
          <Send size={14} aria-hidden="true" />
          {desk.busyId === ended.id
            ? strings.tablet.offerEpisodicBusy
            : strings.tablet.offerEpisodicAction}
        </Button>
      </div>
    </>
  );
}

/** The outcome of the last correction or resolution on this session, if any. */
export function CorrectOutcomeNotice({
  desk,
  subjectKey,
  testId,
}: {
  desk: PushDesk;
  subjectKey: string;
  testId: string;
}) {
  if (desk.correctOutcome?.id !== subjectKey) return null;
  return (
    <Notice
      tone={desk.correctOutcome.ok ? 'ok' : 'stop'}
      title={strings.tablet.correctAction}
      data-testid={testId}
    >
      {desk.correctOutcome.text}
    </Notice>
  );
}

/** The outcome of the last recall, re-send or send-again on this session. */
export function SessionOutcomeNotice({
  desk,
  id,
  testId,
  linkTestId,
  recallTestId,
}: {
  desk: PushDesk;
  id: string | undefined;
  testId: string;
  linkTestId: string;
  recallTestId: string;
}) {
  const outcome = desk.pushOutcome && desk.pushOutcome.id === id ? desk.pushOutcome : null;
  if (!outcome) return null;
  return (
    <Notice tone={outcome.ok ? 'ok' : 'stop'} title={strings.tablet.recallAction} data-testid={testId}>
      {outcome.info ? (
        <RefusalOutcomeBody
          info={outcome.info}
          canSend={desk.canSend}
          busy={desk.busyId !== null}
          onRecall={(sessionId) => void desk.recall(sessionId)}
          linkTestId={linkTestId}
          recallTestId={recallTestId}
        />
      ) : (
        outcome.text
      )}
    </Notice>
  );
}
