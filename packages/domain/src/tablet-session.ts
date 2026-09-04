/**
 * PUSH-TO-DEVICE CAPTURE — reception hands the patient a locked screen
 * (TODO.md "Push-to-device capture", "Two front doors", Carl 4 Sep 2026).
 *
 * THE SECOND FRONT DOOR, and it is a different use case rather than a
 * different kiosk. The walk-up kiosk at `/kiosk` is for an unsupported patient
 * who finds their own name and types their details to prove it is them. This
 * is for the patient standing AT RECEPTION, whose Medicare card has already
 * been checked, who has already been matched in the PMS, and who has already
 * been asked date of birth, mobile, email and address across the desk — the
 * three-identifier staff check (REQ-VER-03). They never search and they never
 * type; they tick their details as correct, read, and approve.
 *
 * WHY THE PUSH IS STRONGER ON THE HARD RULE, not merely faster. REQ-REG-06
 * says the particulars must be complete and locked before the signature
 * control can enable, and signing a draft is the criminal offence in this
 * regime. In a PULL model a device assembles a payload and then asks. In a
 * PUSH model the payload is validated and locked on the SERVER before any
 * device sees it, so a tablet structurally cannot hold a draft.
 *
 * THE PUSH IS THE VERIFICATION RECORD. Reception cannot push until the
 * staff-verified check is recorded, and the push carries the staff identity
 * (REQ-VER-03/-04). The patient's ticks that follow are NOT a verification and
 * must never be recorded as one: a displayed value confirmed by whoever holds
 * the tablet proves nothing about who is holding it. They are a data-accuracy
 * confirmation, which is part of the agreement ceremony.
 *
 * WHAT IS IN THIS FILE. The shapes and rules both halves of the product must
 * agree on — the state machine, the idle timeout, the field lists, and the
 * projection that builds the tablet's payload by PICKING permitted fields.
 * The tablet, the console and the server all read them from here, so no two of
 * them can hold different opinions about what a session is.
 */

import type { AgreementType } from './agreement';

/**
 * THE STATES, and the two halves of the list are the whole design.
 *
 * Three of them are LIVE — the tablet is showing something and the session
 * still owns the device. Four are ENDED, and an ended session is over: it
 * never reopens, it releases the device, and the tablet's next poll sees
 * nothing. That is what makes "one session per device" a fact about the
 * database rather than a hope about the callers.
 */
/**
 * `details_disputed` IS LIVE, NOT AN ENDING (Carl, 4 Sep 2026). The patient
 * crossed at least one row, so the ceremony stops — Continue is dead on the
 * tablet — but the SESSION does not, and neither does the device's claim on
 * it. Reception sees the cross, corrects the detail at the desk (or records
 * "no change needed") and re-sends, and the re-send is a NEW session. Once the
 * cross has reached reception the patient cannot tick it after all: the tablet
 * locks with "please wait for reception", and a second `confirm-details` on a
 * disputed session is refused with 409 `session_disputed` (Carl, 4 Sep 2026,
 * later the same day — reception may already be correcting the record, so the
 * tablet must not carry on against details mid-correction).
 *
 * ENDING IT WOULD BE THE WRONG SHAPE for two reasons that both bite. The
 * device would be released, so the tablet in the patient's hands would fall
 * back to the idle screen mid-conversation; and reception's live list is built
 * from ACTIVE sessions, so the one row they need to act on is the one row that
 * would vanish. A dispute is a fact about the details, not about the session.
 */
export const ACTIVE_TABLET_SESSION_STATES = [
  'pushed',
  'reading',
  'details_confirmed',
  'details_disputed',
] as const;

/**
 * THE FIVE WAYS A SESSION ENDS, and only ONE of them touches the agreement.
 *
 *  - `signed`      — the assignor signed. The agreement moved; the session
 *                    merely records that it did.
 *  - `walked_away` — the "See reception" exit on the tablet, pressed by
 *                    somebody standing at it. NOTHING on the agreement
 *                    changes, and that is REQ-REC-04 in a single word: the
 *                    patient is still seen, and reception chooses a private
 *                    bill or an episodic agreement after the service. A flow
 *                    that punished walking away would be a flow that blocks
 *                    care.
 *  - `timed_out`   — the CLIENT-SIDE inactivity clock fired on a pushed
 *                    session; nobody pressed anything (Carl, 4 Sep 2026).
 *                    Same effect on the record as `walked_away` — the session
 *                    ends, the agreement is untouched, the device is
 *                    released back to idle — but a different stored state, so
 *                    reception can tell "the patient asked for help" from
 *                    "the patient's record sat on the screen until the clock
 *                    reset it". Distinct from `expired` below: that is the
 *                    SERVER giving up after thirty minutes of no request at
 *                    all; this is the tablet's own five-minute-by-default
 *                    clock (`useInactivityReset`), which almost always fires
 *                    first and posts this state itself.
 *  - `recalled`    — reception took it back from the console. Same: nothing on
 *                    the agreement changes.
 *  - `expired`     — thirty minutes with no request reaching the SERVER at
 *                    all — the backstop for a tablet that never got to post
 *                    its own timeout (killed, offline, crashed). Same again.
 */
export const ENDED_TABLET_SESSION_STATES = [
  'signed',
  'walked_away',
  'timed_out',
  'recalled',
  'expired',
] as const;

export const TABLET_SESSION_STATES = [
  ...ACTIVE_TABLET_SESSION_STATES,
  ...ENDED_TABLET_SESSION_STATES,
] as const;

export type ActiveTabletSessionState = (typeof ACTIVE_TABLET_SESSION_STATES)[number];
export type EndedTabletSessionState = (typeof ENDED_TABLET_SESSION_STATES)[number];
export type TabletSessionState = (typeof TABLET_SESSION_STATES)[number];

export function isTabletSessionState(value: string): value is TabletSessionState {
  return (TABLET_SESSION_STATES as readonly string[]).includes(value);
}

export function isActiveTabletSessionState(value: string): value is ActiveTabletSessionState {
  return (ACTIVE_TABLET_SESSION_STATES as readonly string[]).includes(value);
}

/**
 * THE STATES THE TABLET MAY SET ITSELF, which is deliberately not all of them.
 *
 * A device may say it is showing the agreement, that the person walked away,
 * or that its own inactivity clock ended the session with nobody there
 * (`timed_out`, Carl 4 Sep 2026 — same effect as `walked_away`, different
 * label, so reception can tell the two apart). It may NOT declare itself
 * signed — that is what a signature event says, and a device that could
 * assert it would be a device that could assert a contract. It may not
 * recall itself either; recall is a console act, for the same reason revoke
 * is (TODO.md "Zero-footprint kiosk"). And it may not declare itself
 * `expired` — that is the SERVER's own word for giving up on a screen nobody
 * asked it to watch; a device cannot assert that about itself.
 */
export const DEVICE_SETTABLE_TABLET_SESSION_STATES = ['reading', 'walked_away', 'timed_out'] as const;
export type DeviceSettableTabletSessionState = (typeof DEVICE_SETTABLE_TABLET_SESSION_STATES)[number];

export function isDeviceSettableTabletSessionState(
  value: string,
): value is DeviceSettableTabletSessionState {
  return (DEVICE_SETTABLE_TABLET_SESSION_STATES as readonly string[]).includes(value);
}

/**
 * THIRTY MINUTES OF NOTHING AND THE SESSION IS OVER.
 *
 * A tablet in a waiting room showing somebody's date of birth and address is
 * the screen-hygiene problem the pull model never had (TODO.md
 * "Push-to-device capture"). The patient who was called in, or who wandered
 * off, must not leave their particulars on a screen anyone can read; and the
 * device must not stay busy so that the next push is refused for a session
 * nobody is standing at.
 *
 * IT CHANGES NOTHING ON THE AGREEMENT. An expiry is the platform giving up on
 * a screen, never on a patient.
 */
export const TABLET_SESSION_IDLE_MS = 30 * 60 * 1000;

export function tabletSessionIsStale(lastStateAt: Date | string, now: Date = new Date()): boolean {
  const at = lastStateAt instanceof Date ? lastStateAt : new Date(lastStateAt);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() >= TABLET_SESSION_IDLE_MS;
}

/**
 * WHAT THE PATIENT TICKS, AND WHY IT IS NOT THE IDENTIFIER LIST.
 *
 * Three of these — name, date of birth, address — are also approved
 * identifiers. Two are NOT: a mobile number and an email address are CONTACT
 * DETAILS and are never identity identifiers (REQ-VER-02; TODO.md calls this
 * "the Medicare-number mistake, one step sideways"). Show them, confirm them,
 * and never count them toward the three or log them as an identifier type.
 *
 * SO THIS LIST IS DELIBERATELY A DIFFERENT LIST FROM `APPROVED_IDENTIFIER_TYPES`
 * even though it overlaps it, and the event it produces is deliberately not a
 * verification event. Ticking a displayed value is a DATA-ACCURACY check by
 * whoever is holding the tablet; verification is the staff check across the
 * desk that the push already recorded (REQ-VER-03).
 */
export const CONFIRMABLE_DETAIL_TYPES = [
  'name',
  'date_of_birth',
  'address',
  'mobile',
  'email',
] as const;

export type ConfirmableDetailType = (typeof CONFIRMABLE_DETAIL_TYPES)[number];

export function isConfirmableDetailType(value: string): value is ConfirmableDetailType {
  return (CONFIRMABLE_DETAIL_TYPES as readonly string[]).includes(value);
}

/**
 * THE THREE THAT ARE PARTICULARS, AND THE TWO THAT ARE NOT (Carl, 4 Sep 2026).
 *
 * Name, date of birth and address are the patient's own particulars — the
 * D-set facts the agreement is about. A mobile number and an email address are
 * CONTACT details: they say where a copy of the agreement goes, and they say
 * nothing about the contract. So correcting one of the first three on a LOCKED
 * agreement means the artefact that was rendered and hashed no longer states
 * what the platform holds, and the correction supersedes rather than edits
 * (HARD-02). Correcting a mobile or an email never does.
 *
 * ONE HONEST CAVEAT, STATED HERE BECAUSE IT WILL BE MISREAD OTHERWISE. Of the
 * three, only the NAME actually reaches the rendered artefact today —
 * `prepareLock` assembles `patientName` and nothing else about the person, so
 * a corrected date of birth or address changes no hashed byte as the renderer
 * currently stands. This list is deliberately WIDER than that: it is the
 * D-set as Carl named it, it fails toward superseding rather than toward
 * quietly re-using a locked contract, and a renderer that grows a date of
 * birth later must not silently turn a safe rule into an unsafe one. Narrowing
 * it is a decision for Carl, not a tidy-up.
 */
export const PARTICULAR_DETAIL_TYPES = ['name', 'date_of_birth', 'address'] as const;

export type ParticularDetailType = (typeof PARTICULAR_DETAIL_TYPES)[number];

export function isParticularDetailType(value: string): value is ParticularDetailType {
  return (PARTICULAR_DETAIL_TYPES as readonly string[]).includes(value);
}

/** Does correcting any of these types mean the locked agreement must be superseded? */
export function correctionTouchesParticulars(types: readonly string[]): boolean {
  return types.some(isParticularDetailType);
}

/**
 * WHAT RECEPTION MAY CORRECT ON THE PLATFORM'S MIRROR, and the list is the
 * whole of it (TODO.md "Check-your-details", Carl 4 Sep 2026).
 *
 * SIX FIELDS, FIVE DETAIL TYPES — the name is two columns and one row on the
 * tablet, because a patient does not read "given names" and "family name" as
 * two questions.
 *
 * THERE IS NO MEDICARE FIELD HERE AND THERE IS NO WAY TO ADD ONE. The card
 * number is not an identity identifier, the exclusion is non-configurable
 * (hard rule 1, REQ-VER-02), and the correction endpoint refuses any field
 * name matching /medicare/i before it looks at this list at all — the ESLint
 * rule would fail the build on the identifier as well.
 *
 * NOR IS THERE A GENDER, PATIENT RECORD NUMBER OR IHI. Those are identifiers
 * the patient was never shown and never asked about, so a dispute cannot be
 * about them and a correction here would be reception editing an identifier
 * off the back of a screen that did not mention it.
 */
export const CORRECTABLE_PATIENT_FIELDS = [
  'givenNames',
  'familyName',
  'dateOfBirth',
  'address',
  'mobile',
  'email',
] as const;

export type CorrectablePatientField = (typeof CORRECTABLE_PATIENT_FIELDS)[number];

export function isCorrectablePatientField(value: string): value is CorrectablePatientField {
  return (CORRECTABLE_PATIENT_FIELDS as readonly string[]).includes(value);
}

/**
 * WHICH TICK-BOX A CORRECTED COLUMN ANSWERS. The vault event records the TYPE
 * (REQ-VER-04) — `name`, not "Jamie Sampleton" and not `givenNames` — so the
 * evidence reads in the same vocabulary the patient's cross did.
 */
const DETAIL_TYPE_BY_FIELD: Readonly<Record<CorrectablePatientField, ConfirmableDetailType>> = {
  givenNames: 'name',
  familyName: 'name',
  dateOfBirth: 'date_of_birth',
  address: 'address',
  mobile: 'mobile',
  email: 'email',
};

export function detailTypeForPatientField(field: CorrectablePatientField): ConfirmableDetailType {
  return DETAIL_TYPE_BY_FIELD[field];
}

/**
 * WHICH ROWS THE TABLET DREW, DECIDED BY THE SERVER RATHER THAN TAKEN FROM THE
 * DEVICE.
 *
 * A row the practice holds nothing for is not drawn — nobody is shown a blank
 * line and asked whether it is correct — so "every row answered" means exactly
 * "every type in this list". The tablet derives the same set from the same
 * payload, and `confirm-details` CHECKS the two agree instead of trusting the
 * device's arithmetic: a session that reached `details_confirmed` having
 * answered three of five rows would be a ceremony record that says more than
 * happened.
 */
export function shownDetailTypesFor(patient: TabletSessionPatient): readonly ConfirmableDetailType[] {
  const shown: ConfirmableDetailType[] = [];
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    const value =
      type === 'name'
        ? [patient.givenNames, patient.familyName].map((part) => (part ?? '').trim()).join(' ')
        : type === 'date_of_birth'
          ? (patient.dateOfBirth ?? '')
          : type === 'address'
            ? (patient.address ?? '')
            : type === 'mobile'
              ? (patient.mobile ?? '')
              : (patient.email ?? '');
    if (value.trim().length > 0) shown.push(type);
  }
  return shown;
}

/**
 * WHY A PUSH WAS REFUSED — a CODE, never the rule's own sentence with data
 * folded into it, and never anything about the patient.
 *
 * The console maps each of these to its own string-table entry, so a refusal
 * reads as guidance to a receptionist rather than as a server error. `other`
 * is the fallback, so a reason this list has not met yet still renders as
 * something a person can act on.
 */
export const PUSH_BLOCKED_REASONS = [
  /** No such tablet in this practice. A cross-practice id lands here too — RLS fails closed. */
  'device_unknown',
  /** Revoked in the console. It holds no credential and would show nothing. */
  'device_revoked',
  /** Registered but never paired: the code was issued and nobody typed it in. */
  'device_not_paired',
  /** One session per device. The console is told the session id so it can offer Recall. */
  'device_busy',
  'agreement_not_found',
  /** Signed, superseded, declined, expired — past the point a push could mean anything. */
  'agreement_not_pushable',
  /** D6a missing, or set from a mapping that has since moved (hard rule 14). */
  'service_description_missing',
  /**
   * D7 is explicit and is set at the DESK, before the push
   * (`POST /agreements/:id/assignor`). A tablet must never be handed an
   * agreement whose signing party is unknown.
   */
  'who_is_signing_unset',
  /**
   * REQ-CHILD-01, failing closed (REQ-CHILD-07) and consistently with
   * everything else in the capture path: the cascade declines to stage a
   * flagged patient and the walk-up waiting list omits them, so the push
   * declines too rather than being the one door left open. Reception carries
   * on — paper, or a private bill after the service. Nothing here blocks care
   * (REQ-REC-04).
   */
  'patient_confidential',
  /**
   * ENDURING IS NOT PUSHABLE YET, and this is a reported gap rather than a
   * decision. The s 65C rule set is a human-authored zone (CLAUDE.md §7): it
   * has no enduring path — C6 skips D6a for the type, C5 still demands a
   * single service date a standing agreement does not have, and the
   * conformance suite has no enduring case at all. Filling that in from an
   * agent would be authoring regulation. So the push refuses, visibly, and
   * says why.
   */
  'enduring_not_supported',
  'other',
] as const;

export type PushBlockedReason = (typeof PUSH_BLOCKED_REASONS)[number];

/**
 * WHAT THE TABLET IS SHOWN ABOUT THE PATIENT, and the list is the contract.
 *
 * IT CARRIES VALUES, WHICH THE WALK-UP KIOSK'S WAITING LIST DOES NOT, and the
 * justification is specific rather than general: THE DEVICE IS PAIRED to this
 * practice, THE SESSION WAS PUSHED by a named staff member who has just
 * verified this person across the desk, and THE PERSON READING THE SCREEN IS
 * THE PERSON THE VALUES BELONG TO — reception hands them the tablet. This is
 * the one screen in the product where showing a date of birth is showing
 * somebody their own date of birth, at the moment they were asked for it.
 * Everything that makes that true is enforced elsewhere: the credential
 * (device pairing), the staff actor (the push), one session per device (a
 * partial unique index), and the thirty-minute idle expiry above.
 *
 * THERE IS NO MEDICARE NUMBER HERE AND THERE IS NO COLUMN FOR ONE. The card is
 * checked in the PMS, before the platform is involved, and it is not an
 * identity identifier in any case (hard rule 1, REQ-VER-02). The named test
 * `session_payload_never_carries_a_medicare_number` asserts the serialised
 * payload has no such key.
 *
 * NO BENEFIT AND NO DOLLAR AMOUNT — hard rule 4. There is no field for one.
 */
export const TABLET_SESSION_PATIENT_FIELDS = [
  'givenNames',
  'familyName',
  /** ISO `yyyy-mm-dd`. Shown to its owner, ticked by its owner. */
  'dateOfBirth',
  'address',
  /** CONTACT, NEVER IDENTITY (REQ-VER-02). */
  'mobile',
  'email',
] as const;

export type TabletSessionPatientField = (typeof TABLET_SESSION_PATIENT_FIELDS)[number];

export interface TabletSessionPatient {
  givenNames: string;
  familyName: string;
  dateOfBirth: string | null;
  address: string | null;
  mobile: string | null;
  email: string | null;
}

/**
 * Build the patient block by taking ONLY the permitted fields. Anything else
 * on the source row — an IHI, a patient record number, a confidentiality flag,
 * a PMS linkage key — is dropped here and cannot reach a tablet even if
 * somebody spreads a whole patient record in later. The same construction, and
 * the same reason, as `projectKioskWaitingRow`.
 */
export function projectTabletSessionPatient(source: Record<string, unknown>): TabletSessionPatient {
  const patient: Record<string, unknown> = {};
  for (const field of TABLET_SESSION_PATIENT_FIELDS) patient[field] = source[field] ?? null;
  return patient as unknown as TabletSessionPatient;
}

/**
 * WHO IS SIGNING, as the tablet is told it.
 *
 * D7 IS EXPLICIT AND IS NEVER INFERRED (CLAUDE.md §3). `isPatient` is the
 * discriminator; `name` and `relationship` are present only on the other
 * branch, because a field that is optional in general is a field the reader
 * has to guess about. The tablet PRINTS this and never asks it — the party was
 * settled at the desk before the push.
 */
export interface TabletSessionAssignor {
  isPatient: boolean;
  name?: string;
  relationship?: string;
}

/**
 * THE ONE PAYLOAD `GET /kiosk/session` RETURNS. The tablet builds against this
 * type and never against the server's code.
 */
export interface TabletSessionPayload {
  id: string;
  state: ActiveTabletSessionState;
  /** Which of the four types this is, so the ceremony picks its own heading. */
  agreementType: AgreementType;
  patient: TabletSessionPatient;
  assignor: TabletSessionAssignor;
  agreementId: string;
  /**
   * The `in_practice` capture request this session signs against. Passed
   * straight back to the EXISTING `POST /agreements/:id/sign`; completing it
   * closes every other open channel for the agreement (FR-2.7).
   */
  captureRequestId: string;
}

/**
 * A session as the CONSOLE lists it — a staff surface, so the patient's name
 * is allowed here exactly as it is on every other practice list. No date of
 * birth, no address, no contact detail: reception is watching a state, not
 * mirroring a screen (TODO.md, "reception sees a STATUS ... not a live
 * mirror: cheaper, and less on screen").
 */
export interface TabletSessionRow {
  id: string;
  deviceId: string;
  deviceLabel: string;
  agreementId: string;
  agreementType: AgreementType;
  patientName: string;
  /**
   * SO RECEPTION CAN CORRECT A DISPUTED DETAIL FROM THIS ROW. An id, not a
   * detail: the values themselves are fetched on demand when somebody opens
   * the correction control, never carried on the three-second poll — this list
   * stays a status rather than becoming a mirror of the tablet's screen.
   */
  patientId: string;
  providerName: string | null;
  state: TabletSessionState;
  /**
   * WHICH DETAILS THE PATIENT CROSSED — TYPES, never the values behind them
   * (REQ-VER-04, hard rule 9). Reception reads "Patient says wrong: address,
   * mobile" and looks up the values on their own screen, which they may see
   * because it is a staff surface and they asked for them at the desk minutes
   * ago. The wire never carries them.
   */
  disputedDetails: string[];
  /** The staff member who pushed it, by display name. */
  pushedBy: string;
  pushedAt: string;
  lastStateAt: string;
  endedAt: string | null;
}

/**
 * MAY THIS SESSION MOVE TO THAT STATE?
 *
 * ONE RULE, AND IT IS THE ONLY ONE WORTH ENCODING: an ended session never
 * moves again. Everything else about the order — ticked before read, read
 * before signed — is enforced by which endpoint can set which state, which is
 * a narrower and more honest fence than a transition table nobody can see the
 * whole of. A recalled session that could be re-opened by a slow poll landing
 * after the recall is the actual bug this prevents.
 */
export function canChangeTabletSessionState(from: string, to: TabletSessionState): boolean {
  if (!isActiveTabletSessionState(from)) return false;
  return from !== to;
}
