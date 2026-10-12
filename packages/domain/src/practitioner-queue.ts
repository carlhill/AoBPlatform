/**
 * WHO IS WAITING FOR ME, AND IS THEIR PAPERWORK DONE
 * (PRACTITIONER-QUEUE-PAGE.md §3 and §5; Carl, 12 September 2026).
 *
 * A NEW FILE RATHER THAN A FUNCTION ON AN EXISTING ONE, and the reason is the
 * spec's: *"The flattening to three words belongs in the domain package beside
 * the front desk's own view function, so the two pages cannot disagree about
 * what 'Done' means."* One definition, imported by the core read that builds
 * the list and by the console that renders it, so a change to what counts as
 * "Done" cannot land on one screen and not the other.
 *
 * THE PAGE IS ABOUT PAPERWORK, NOT ABOUT THE WAITING ROOM (§2). `VISIT-
 * WORKFLOW.md` is explicit that the PMS is the register of patients and this
 * platform keeps no shadow patient list, and a screen headed "your waiting
 * patients" is the likeliest place in the whole product to breach that by
 * accident. So the row below carries a name, a time and one word — and there
 * is deliberately NO FIELD on it for a reason for the visit, a clinical note,
 * a triage category, a duration or an appointment status. A leak cannot be
 * "fixed later in the component" if the type has nowhere to put it.
 *
 * AND NO IDENTIFIER VALUES, ANYWHERE (hard rules 1 and 9). There is no
 * Medicare-number field here and there never will be — the Medicare card
 * number is not an identity identifier (REQ-VER-02) — and no date of birth, no
 * address, no IHI. Ids travel; values do not.
 *
 * NOTHING HERE GATES A CONSULTATION (hard rule 8, REQ-REC-04). Every value
 * below is a REPORT. `not_yet` is not a refusal and must never be rendered as
 * one: the practitioner sees that patient exactly as they always would, and
 * the page says so in as many words rather than leaving it to be inferred.
 */

/**
 * THE THREE WORDS, AND ONE MORE THAT §3 DID NOT ANTICIPATE.
 *
 * §3 names three: **Done**, **With the patient now**, **Not yet**. Those are
 * the three states of a visit that needs an agreement, and they are unchanged.
 *
 * `nothing_to_sign` IS AN ADDITION, AND IT IS FLAGGED FOR CARL rather than
 * assumed (wow.md §9: a decision made mid-build is still Carl's to confirm).
 * It exists because `ARRIVAL-WHO-IS-SEEN.md` §3 landed a case §3 of the queue
 * plan was written before: a patient who came only for a specimen collection
 * is seen by somebody who bills nothing, so the visit decision is `none` and —
 * in Carl's own words — *"that is a correct, complete answer"*. There is no
 * agreement, and there never will be one.
 *
 * The three words cannot say that honestly. "Not yet" would put a permanent
 * false alarm against every phlebotomy patient on a page whose entire job is
 * to answer "is the paperwork done", and "Done" would claim a signature that
 * does not exist — which the named test
 * `paperwork_reads_done_only_when_it_is_signed_and_stored` forbids outright.
 * So the honest answer gets its own word.
 *
 * IF CARL WANTS THREE, the change is one line in the map below plus its
 * string, not a rewrite: nothing else in the product branches on this value.
 */
export const PAPERWORK_STATES = ['done', 'with_the_patient_now', 'not_yet', 'nothing_to_sign'] as const;
export type PaperworkState = (typeof PAPERWORK_STATES)[number];

/**
 * WHETHER THIS VISIT NEEDS AN AGREEMENT AT ALL — a fact, never a reason code.
 *
 * DELIBERATELY NOT THE POLICY TABLE'S RULE KEYS. `visit-agreement-policy.json`
 * decides what a visit needs and its keys are VERSIONED CONTENT (hard rule
 * 14); a function that switched on `already_covered_by_an_enduring_agreement`
 * would be a second, unversioned copy of that mapping, in TypeScript, which is
 * precisely what rule 14 exists to prevent. These three are facts the caller
 * can state about the visit in front of it, and they stay true whatever the
 * table is edited to say next quarter.
 *
 *  - `yes` — this visit needs a signature, and one is or is not there yet.
 *  - `covered_already` — a signed, stored agreement made earlier already
 *    assigns the benefit for this service. The patient signs nothing today and
 *    the answer is "Done", because it IS done.
 *  - `no` — no Medicare claim will be made, so there is no benefit to assign
 *    and nothing to sign, now or later (ARRIVAL-WHO-IS-SEEN.md §3, the
 *    `not_billable` row).
 */
export type AgreementNeeded = 'yes' | 'covered_already' | 'no';

/** What the caller knows about one visit's paperwork. No clinical fact among them. */
export interface VisitPaperwork {
  /**
   * THE SIGNATURE EVENT ON THE AGREEMENT, or null.
   *
   * "Done" MEANS SIGNED AND STORED, and this is what says so: the id of the
   * event in the non-repudiation chain, not a status column somebody could set
   * by hand and not a `signed` string. An agreement can be locked, sent, read
   * and confirmed without this being present; none of those are Done.
   */
  readonly signatureEventId: string | null;
  /**
   * THE PATIENT HAS IT IN THEIR HANDS RIGHT NOW — an open capture session on
   * a paired tablet. Not "sent", not "pending": open.
   */
  readonly liveCaptureSession: boolean;
  readonly agreementNeeded: AgreementNeeded;
}

/**
 * ONE VISIT, FLATTENED TO ONE WORD.
 *
 * THE ORDER IS THE MEANING, and it is not alphabetical:
 *
 *  1. A SIGNATURE BEATS EVERYTHING. A stale live-session flag — a poll that
 *     crossed the signature on the wire, a session row not yet closed — must
 *     never hide a signature that exists. The most finished answer wins.
 *  2. THEN "no agreement will ever be needed", because it is also finished and
 *     it must not be read as a state something is on its way out of.
 *  3. THEN somebody is signing right now.
 *  4. OTHERWISE not yet — which is a report and never a refusal (hard rule 8).
 */
export function paperworkFor(visit: VisitPaperwork): PaperworkState {
  if (visit.signatureEventId) return 'done';
  if (visit.agreementNeeded === 'covered_already') return 'done';
  if (visit.agreementNeeded === 'no') return 'nothing_to_sign';
  if (visit.liveCaptureSession) return 'with_the_patient_now';
  return 'not_yet';
}

/**
 * ONE PERSON WAITING.
 *
 * WHAT IS NOT HERE IS THE POINT (§2 and §4). No reason for the visit, no note,
 * no triage, no duration, no appointment status, no identifier value, no
 * amount (hard rule 4), no agreement id and no control that acts on one — §3:
 * *"a control they will never legitimately use is a control that will one day
 * be pressed by mistake."*
 *
 * NO CARD-NUMBER FIELD YET, AND THAT IS DELIBERATE. §3 wants the queue ticket
 * *"where the practice uses them"*, sourced from `Arrival.queueTicket`
 * (`QUEUE-TICKETS.md`). That column does not exist in `schema.prisma` today.
 * Inventing one here would mean a column on screen that is always blank, or
 * worse a number derived from something else and mistaken for the one the room
 * is being called by. It is left out entirely until the field lands.
 */
export interface WaitingRow {
  /** The arrival — the row's identity, and the only id on it. */
  readonly arrivalId: string;
  readonly patientName: string;
  /**
   * WHEN THEY ARRIVED — not a countdown and not a target (§3). By the
   * practice's clock (`Arrival.arrivedAt`), ISO 8601, formatted where it is
   * shown rather than here.
   */
  readonly waitingSince: string;
  readonly paperwork: PaperworkState;
  /**
   * WHOSE AGREEMENT IT IS, when that is somebody other than the person the
   * patient came to see (§6a).
   *
   * A nurse's list shows visits whose agreement is anchored on the supervising
   * provider, and *"'Dr Chen's agreement — done' is honest; 'your agreement'
   * would not be."* Null whenever the two are the same person, which is every
   * ordinary GP visit — so a name here is always a difference worth saying.
   */
  readonly agreementProviderName: string | null;
  /**
   * WHERE THE VISIT HAS GOT TO — Pending, With patient now, Completed or
   * Reassign (§3a; Carl, 12 Sep 2026).
   *
   * A KEY FROM `content/visit-states.json`, NEVER A WORD. The list is versioned
   * content and the display labels live in the string table keyed by this
   * (CLAUDE.md §7), so the list can change without a code change and a screen
   * can never disagree with the record about what a state means.
   *
   * IT IS ATTENDANCE, NOT A CLINICAL FACT, and that is what lets it sit on a
   * row §2 otherwise forbids everything from. It says a person was with a
   * patient, or is no longer; it says nothing about why they were there or what
   * was found. There is still no field here for a reason, a note, a triage
   * category or a duration, and there never will be.
   *
   * `pending` FOR EVERY UNTOUCHED ROW, which is honest and is not a warning:
   * nothing about it gates a consultation or a bill (§3a rule 5, hard rule 8).
   */
  readonly visitState: string;
}

/**
 * EVERYBODY WAITING FOR ONE PRACTITIONER.
 *
 * A GROUP EVEN IN THE SINGLE-PRACTITIONER CASE, so the two modes of the page
 * are one shape rendered twice rather than two renderers that can drift. A
 * practitioner sees exactly one group — their own — and reception sees one per
 * practitioner with somebody waiting.
 */
export interface WaitingGroup {
  /**
   * The affiliation the patients are here to see — practitioner AT this
   * practice, which is the thing an arrival names. Null only where the arrival
   * named nobody we could resolve, and the group then says so rather than
   * silently dropping the people in it.
   */
  readonly affiliationId: string | null;
  readonly practitionerName: string | null;
  readonly rows: readonly WaitingRow[];
}

/**
 * WHOSE LIST IS BEING ASKED FOR — decided by the SERVER from the token, never
 * sent up by the browser.
 *
 *  - `mine` — a practitioner's own list, and only ever their own. §4.2: *"Never
 *    show another practitioner's list. Scoped to the signed-in practitioner,
 *    enforced at the query."* The browser cannot ask for anybody else's
 *    because there is no parameter in which to ask.
 *  - `practice` — every practitioner at this practice, grouped (Carl, 12 Sep
 *    2026, widening the audience: an administrator, a manager or reception
 *    needs to know who is waiting for whom, and for them the grouping IS the
 *    page).
 */
export const WAITING_SCOPES = ['mine', 'practice'] as const;
export type WaitingScope = (typeof WAITING_SCOPES)[number];

export interface WaitingList {
  readonly scope: WaitingScope;
  /**
   * THE PRACTICE THIS LIST IS FOR, for the session badge (Carl, 12 Sep 2026:
   * "AOBPLATFORM should actually say the PracticeName the Practitioner is
   * working at"). A practitioner's token carries no practice claim, so the
   * page cannot name the practice from the session — the server, which
   * resolved the practice to answer at all, says it here. Display only.
   */
  readonly practiceName?: string | null;
  readonly groups: readonly WaitingGroup[];
}

/**
 * WHICH PRACTITIONER THE PATIENT CAME TO SEE, from the arrival's two fields.
 *
 * `seeingAffiliationId` IS THE ANSWER WHERE THERE IS ONE
 * (ARRIVAL-WHO-IS-SEEN.md §2): one field was doing two jobs — who the patient
 * came to see, and who the claim goes under — and for a nurse, a registrar or
 * a phlebotomist those are different people. The new field carries the first
 * and is never refused on billing grounds.
 *
 * `affiliationId` IS THE FALLBACK, and it is CORRECT rather than a guess for
 * every arrival taken before the new field existed: the backfill sets the two
 * equal, and for an ordinary GP visit they name the same person anyway. It is
 * also what a row still carries if a sender omits the new field.
 */
export function whoTheyCameToSee(arrival: {
  readonly seeingAffiliationId?: string | null;
  readonly affiliationId?: string | null;
}): string | null {
  return arrival.seeingAffiliationId ?? arrival.affiliationId ?? null;
}
