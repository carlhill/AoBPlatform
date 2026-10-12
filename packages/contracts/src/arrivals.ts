/**
 * THE ARRIVAL — "this patient has just walked up to reception to see this
 * provider" (Carl, 4 Sep 2026; TODO.md "Reception-centric" §2).
 *
 * WHY WE DEFINE IT AND NOT MEDTECH. Today the reception queue is fed by dev
 * staging scripts and by the appointment sweep; nothing tells the platform that
 * a person actually walked in. D-01 is unresolved — nobody knows yet whether
 * Evolution will push events or whether the site connector will poll the
 * appointment book — and CLAUDE.md §5 is explicit that we do not guess a PMS's
 * API. So we own the SHAPE and leave the TRANSPORT open: whatever D-01 turns
 * out to allow, the connector's job becomes "produce this message". Nothing in
 * this file describes a Medtech endpoint, because nothing here is known.
 *
 * IT CARRIES THE FIVE DETAILS BECAUSE THE PMS IS THE MASTER (REQ-DATA-10).
 * The arrival is the moment the practice's own record is authoritative and
 * ours may be stale, so the push brings the current values and the platform
 * updates its mirror from them, recording WHICH detail types changed and never
 * the values (REQ-VER-04).
 *
 * THERE IS NO MEDICARE NUMBER FIELD, AND THERE IS NO ROOM FOR ONE. The Medicare
 * card number is NOT an identity identifier; the approved set is name, date of
 * birth, gender, address, patient record number and IHI, and the exclusion is
 * non-configurable (hard rule 1, REQ-VER-02). The absence of a field is the
 * first fence; the DTO refusing any key matching /medicare/i OUT LOUD is the
 * second, exactly as `PATCH /patients/:id/details` does — a silently stripped
 * field teaches the sender nothing, and the connector will be written by
 * somebody who needs to learn this once. Named test:
 * `arrival_rejects_a_medicare_number`.
 *
 * THERE IS NO AGREEMENT TYPE FIELD EITHER, and that is the same kind of
 * absence. What a visit needs — a first enduring agreement, an episodic
 * pre-agreement, or nothing because one already covers this provider — is
 * decided by the versioned visit policy in `@aobplatform/domain`, never by the
 * sender (hard rules 6 and 14; named test
 * `arrival_type_is_decided_by_the_rule_set_not_the_pms`).
 *
 * AND NO BENEFIT, NO AMOUNT, NO ITEM NUMBER (hard rule 4). An arrival is a
 * person at a desk, not a claim.
 */
import type { IsoDate, IsoTimestamp } from '@aobplatform/domain';

/**
 * WHERE AN ARRIVAL CAME FROM. `connector` is the site-installed Windows
 * connector (outbound-only mTLS); `dev` is `scripts/dev/arrive.sh` and the
 * test suites; `reception` is a person at the front desk typing it, because
 * the practice management system is down, is not integrated, or has never
 * heard of this walk-in (PMS_to_AoB_Workflow.md case 4, W2). Recorded on the
 * row because "a real practice's software said this", "somebody at the desk
 * typed it" and "somebody ran a script" must never look alike in the evidence.
 */
export const ARRIVAL_SOURCES = ['connector', 'dev', 'reception'] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

/**
 * THE ONLY SOURCE THAT MAY CARRY THE THREE RECEPTION-ONLY FIELDS BELOW.
 *
 * `serviceDate`, `serviceDescription` and `assignor` are answers a PERSON
 * gives. A connector has nobody to ask — which is exactly why the practice's
 * default D6a exists and why the patient is their own assignor on a machine
 * push — so a body carrying one of them under any other source is refused out
 * loud rather than silently obeyed.
 */
export const ARRIVAL_SOURCE_TYPED_BY_A_PERSON: ArrivalSource = 'reception';

export interface ArrivalEvent {
  /**
   * NOT SENT IN THE BODY. Practice scope comes from the request — the
   * `x-practice-id` header in dev, the connector's mTLS identity when that
   * lands — and RLS enforces it at the database. A body that could name its
   * own practice would be a body that could write into another one's records.
   * Present on the type only so a reader can see where scope comes from.
   */
  readonly practiceId?: never;

  /** The practice's own handle for this patient. The join key for the mirror row. */
  readonly pmsPatientRecordNumber: string;

  // The five details, as the PMS holds them right now (REQ-DATA-10).
  readonly familyName: string;
  readonly givenNames: string;
  /** YYYY-MM-DD. */
  readonly dateOfBirth: IsoDate;
  readonly address: string;
  readonly mobile?: string;
  readonly email?: string;

  /**
   * WHICH PRACTITIONER, AT WHICH LOCATION, AND ONE OF THESE IS REQUIRED
   * (Carl, 7 Sep 2026 — the agreement anchor moved to the affiliation).
   *
   * An enduring agreement is per practitioner × patient (hard rule 6,
   * REQ-END-01) and a provider number is issued per practitioner per location
   * (FR-1.8), so an arrival that cannot name the person AND the place cannot
   * be decided at all — and the server resolves all three forms to the one
   * affiliation rather than making the sender do it.
   *
   *   * `affiliationId` — the practitioner at a location, outright.
   *   * `practitionerId` + `locationId` — the same fact, said separately.
   *   * `providerNumber` — names both by itself, and is the likeliest thing a
   *     PMS holds.
   *
   * THESE NAME WHO THE PATIENT CAME TO SEE, AND ARE NEVER REFUSED ON BILLING
   * GROUNDS (Carl, 12 Sep 2026; ARRIVAL-WHO-IS-SEEN.md §2). Anybody the
   * practice rosters may be named: a nurse, a phlebotomist, a registrar, a GP.
   * Whose provider number the CLAIM goes under is a separate fact — the person
   * seen where they bill under their own number, `billingAffiliationId` where
   * they do not. Before this the two shared one field, so an arrival naming a
   * nurse was refused outright and the person the patient actually came to see
   * was discarded.
   */
  readonly affiliationId?: string;
  readonly practitionerId?: string;
  readonly locationId?: string;
  readonly providerNumber?: string;

  /**
   * @deprecated Since 7 September 2026; REMOVE AFTER 30 NOVEMBER 2026.
   *
   * The practice-wide `providers` row. It has no location and no link to a
   * practitioner, which is why it stopped being the anchor: an agreement made
   * from it cannot state who signed for whom or where (s 65C(5)(a)). Still
   * accepted, and resolved to the affiliation it can be matched to; where it
   * matches none, the arrival is refused with `provider_not_anchored` rather
   * than anchored on a guess.
   */
  readonly providerId?: string;

  /** When they arrived, by the practice's clock. */
  readonly arrivedAt: IsoTimestamp;

  readonly source: ArrivalSource;

  /**
   * THE DAY THE SERVICE IS FOR — `reception` ONLY (D5, W2).
   *
   * A machine push has no reason to disagree with the day it sent, so the
   * pipeline takes the service date from `arrivedAt` for every other source.
   * A person at a desk does have one: they may be typing up yesterday's
   * walk-in after the system came back. Sent as a plain date rather than
   * derived from a timestamp because a timestamp near midnight in Sydney is
   * the day before in UTC, and D5 is a particular of a contract.
   */
  readonly serviceDate?: IsoDate;

  /**
   * D6a, CHOSEN FROM THE VERSIONED LIST — `reception` ONLY (REQ-REG-01 D6a,
   * hard rule 14).
   *
   * Never typed: the value must be one of `SERVICE_DESCRIPTIONS`, string for
   * string, because the rules engine's C6 check is exact. Omitted, the
   * practice's own default is used exactly as it is for a connector push.
   */
  readonly serviceDescription?: string;

  /**
   * WHO IS SIGNING, WHEN IT IS NOT THE PATIENT — `reception` ONLY (D7,
   * hard rule 10, REQ-VUL-01/-04/-05, REQ-AGE-01, REQ-REG-08).
   *
   * D7 IS EXPLICIT AND NEVER INFERRED (CLAUDE.md §3), so its absence means
   * the patient is signing for themselves and says so on the record. A PMS
   * push may never assert this: the person standing beside the patient is a
   * fact known at the desk and nowhere else, which is why the field is
   * refused under any other source.
   *
   * THE PLATFORM RUNS THE SAME REFUSALS IT ALWAYS DID. This does not carry a
   * second copy of hard rule 10 — the arrival hands the party to
   * `POST /agreements/:id/assignor`'s own service before the particulars are
   * locked, so practice staff are still hard-blocked against the staff list,
   * a person acting for another still declares they are of full age, and a
   * contact channel is still required (REQ-REG-08). No date of birth is asked
   * for or stored: what is recorded is a declaration (REQ-AGE-01, REQ-VUL-02).
   * Nothing anywhere asks staff to assess capacity (REQ-VUL-05).
   */
  readonly assignor?: {
    readonly name: string;
    /** The word the person chose, from `assignor-relationships.json`. */
    readonly relationship: string;
    /** Which list they chose from (hard rule 14). */
    readonly relationshipsVersion?: string;
    /** reg 65CB(5)'s category, derived from the relationship through that list. */
    readonly authorityBasis: string;
    readonly note?: string;
    /** REQ-AGE-01 — present AND true, or the party is refused. */
    readonly declaresEighteenOrOver: boolean;
    /** Contact, never identity (C7.2 / REQ-REG-08). At least one. */
    readonly mobile?: string;
    readonly email?: string;
  };

  /**
   * WHOSE PROVIDER NUMBER THE CLAIM GOES UNDER, WHEN IT IS NOT THE PERSON THE
   * PATIENT CAME TO SEE — `reception` ONLY (Carl, 12 Sep 2026;
   * ARRIVAL-WHO-IS-SEEN.md §3, middle row).
   *
   * A nurse or a registrar working under a provider delivers the service and
   * bills nothing under their own number, so the assignment goes under the
   * supervising provider. Until somebody names that provider the arrival is
   * still RECORDED — the patient exists, the visit exists, the person seen is
   * kept — and the visit decision is `none` with the reason
   * `billing_provider_not_yet_named`. Sending the same walk-in again under the
   * same `idempotencyKey` with this field set supersedes that waiting row and
   * drafts the agreement.
   *
   * `mayBeProviderOnAgreement` STILL DECIDES WHO MAY GO HERE, unchanged (hard
   * rule 6's neighbour, Carl 5–7 Sep 2026): naming a second nurse is refused
   * with `provider_not_servicing` exactly as it always was. Omitted for an
   * ordinary GP visit, where the person seen bills under their own number.
   *
   * A MACHINE MAY NOT SEND IT, and the refusal is out loud. A
   * `supervisingProviderId` from the PMS was considered on 7 September 2026 and
   * rejected: it would have the practice's software deciding whose name goes on
   * a contract. This is a person's answer at a desk, like D5, D6a and D7.
   */
  readonly billingAffiliationId?: string;

  /**
   * THE SENDER'S OWN HANDLE FOR THIS ARRIVAL. A connector that retries — and
   * a connector on a practice's ADSL will retry — must not put the same person
   * on the queue twice with two agreements to sign. The platform is idempotent
   * on (practiceId, idempotencyKey): a repeat returns the first result and
   * writes nothing.
   *
   * ONE EXCEPTION, AND IT IS THE FIX RATHER THAN A REPEAT: an arrival that was
   * accepted but is still waiting for a billing provider is re-decided when the
   * same key comes back WITH one named, so the walk-in is superseded instead of
   * duplicated. The same shape a refused arrival's retry has always had.
   */
  readonly idempotencyKey: string;

  /**
   * THE NUMBER ON THE CARD IN THE PATIENT'S HAND, IF THERE IS ONE
   * (`QUEUE-TICKETS.md`; Carl, 12 September 2026).
   *
   * OPTIONAL ALWAYS, AND IT GATES NOTHING (§5.1, hard rule 8). A practice with
   * no card box sends none; a practice with one whose box has run out sends
   * none for that patient; neither is refused anything.
   *
   * WHERE IT CAME FROM IS DERIVED FROM `source`, NOT SENT (D-2026-09-12-18).
   * A ticket on a `reception` arrival was read off the practice's own card by
   * a person (`practice_card`); a ticket on a machine push came from their
   * software (`practice_software`); and where a practice uses tickets and
   * neither supplied one, the platform allocates (`allocated`). Letting the
   * caller assert the provenance would let a connector claim a number came off
   * a card box nobody was standing at.
   *
   * IT IS NOT AN IDENTITY IDENTIFIER AND NOTHING VERIFIES BY IT (hard rule 1,
   * REQ-VER-02), it never reaches a rendered agreement (hard rule 4), and it
   * is normalised — trimmed, upper-cased, eight characters at most — before it
   * is stored.
   */
  readonly queueTicket?: string;
}

/** What the platform did about it. */
export interface ArrivalReceipt {
  readonly arrivalId: string;
  readonly patientId: string;
  /**
   * WHAT THE VISIT NEEDS — and `none` now has three meanings, told apart by
   * `reason` and never by the type (Carl, 12 Sep 2026; ARRIVAL-WHO-IS-SEEN.md
   * §5). `already_covered_by_an_enduring_agreement` and
   * `seen_by_a_practitioner_who_does_not_bill` are both COMPLETE answers: the
   * patient is asked for nothing. `billing_provider_not_yet_named` is WAITING:
   * the visit needs a claim and nobody has said whose number it goes under, so
   * the desk names one and re-sends. A caller that reads only the type will
   * treat a waiting arrival as a finished one.
   */
  readonly decision: {
    readonly type: 'enduring' | 'episodic_pre' | 'none';
    readonly reason: string;
  };
  /**
   * WHO THE PATIENT CAME TO SEE, as the practitioner at a location — which is
   * not always who the claim goes under. The same id the sender named, kept
   * whatever their billing role; null only on rows written before 12 September
   * 2026 that had no affiliation at all.
   */
  readonly seeingAffiliationId: string | null;
  /** Null when the decision was `none` — nothing was drafted, and that is the answer. */
  readonly agreementId: string | null;
  /** Hard rule 14: the version of the table that decided (`visit-policy-1`). */
  readonly policyVersion: string;
  /** True on a retry: this arrival had already been processed. */
  readonly repeat: boolean;
}

/**
 * WHY AN ARRIVAL WAS REFUSED — a reason CODE, never prose (Carl, 4 Sep 2026:
 * "shortcuts to the answer, not directions to a screen"; 5–7 Sep 2026: the
 * billing role).
 *
 * The code is what travels; the words and the destination are the console's,
 * mapped from it, so an unmapped code shows itself and can be diagnosed rather
 * than disappearing into a generic sentence.
 */
export const ARRIVAL_REFUSAL_REASONS = [
  /**
   * NARROWED ON 12 SEPTEMBER 2026 (ARRIVAL-WHO-IS-SEEN.md §5). It used to mean
   * "the person named cannot be the provider on an agreement", which refused
   * every arrival naming a nurse or a phlebotomist and threw away the person
   * the patient came to see. Those are now RECORDED, with a visit decision from
   * the versioned policy table. What is left under this code is:
   *
   *   * a role this platform does not recognise — a row written by something
   *     that is not this platform, or a content file rolled back under a
   *     database that was not. Nothing can be decided from it, so nothing is;
   *   * `billingAffiliationId` naming somebody who may not be the provider on
   *     an agreement. Naming a second nurse as the supervising provider is the
   *     same mistake in a new field and gets the same answer.
   */
  'provider_not_servicing',
  /**
   * The arrival named a legacy `providers` row that matches no practitioner at
   * any of this practice's locations, so an agreement made from it could not
   * state who signed for whom or where (s 65C(5)(a)). Reachable only through
   * the deprecated `providerId` field, and it goes when that does. Reception
   * picks the practitioner; nothing is guessed.
   */
  'provider_not_anchored',
] as const;
export type ArrivalRefusalReason = (typeof ARRIVAL_REFUSAL_REASONS)[number];

/**
 * ONE ARRIVAL WAITING FOR RECEPTION TO NAME A PROVIDER.
 *
 * WHAT IS AND IS NOT HERE. The provider who was named and the role that
 * refused them, because that is what has to be understood before it can be
 * fixed. The patient's name ONLY when the practice already had a record of
 * them — a refused arrival changes nothing about the person, so a walk-in the
 * platform has never seen is identified by the practice's own record number,
 * which is what reception reads off their own screen. No date of birth, no
 * address, no contact detail: this is a "whose name goes on it" list, not a
 * patient record (REQ-DATA-10). Never a Medicare number, which is not held at
 * all (hard rule 1), and never an amount (hard rule 4).
 */
export interface RefusedArrival {
  readonly arrivalId: string;
  readonly reason: ArrivalRefusalReason | string;
  /** The practice's own handle for the patient — always present. */
  readonly pmsPatientRecordNumber: string;
  /** Only when the practice already had a record of this person. */
  readonly patientName: string | null;
  /** The practitioner at a location the arrival resolved to, where it resolved to one. */
  readonly affiliationId: string | null;
  /** @deprecated The legacy `providers` row, where the arrival came in by one. */
  readonly providerId: string | null;
  readonly providerName: string | null;
  /**
   * The role that refused them, so the sentence on screen can name it. Null
   * where no role is RECORDED — which is not the same as `servicing_provider`,
   * and the screen must not read it as one.
   */
  readonly billingRole: string | null;
  /** ISO-8601, as the row holds it. Plain `string` — this shape crosses to a browser. */
  readonly arrivedAt: string;
  readonly source: ArrivalSource;
}

/**
 * A SERVICING PRACTITIONER, AT A LOCATION, reception may choose instead.
 *
 * It is the affiliation and not the person, because the provider number and
 * the place of practice that go on the agreement are both per location — and
 * because a practitioner working at two of the practice's sites is two
 * choices, which is a thing reception knows and the platform must not decide.
 * `locationLabel` is there so those two choices are told apart on screen.
 */
export interface ArrivalProviderChoice {
  readonly affiliationId: string;
  readonly name: string;
  readonly providerType: string;
  /** The practice's own label for the site — its code, else the suburb. */
  readonly locationLabel: string | null;
}

/**
 * WHAT THE VISIT WOULD NEED, ASKED BEFORE ANYTHING IS WRITTEN (W2, Carl
 * 7 Sep 2026).
 *
 * WHY A READ AND NOT A GUESS ON THE SCREEN. Reception does not choose what
 * the visit needs — the versioned visit policy does (hard rules 6 and 14), and
 * it needs facts the form cannot see: is this practitioner a GP at this
 * location, do they bill under their own number, does this patient already
 * hold a live ongoing agreement with this PERSON at any of the practice's
 * sites. So the form ASKS, and shows the answer above Submit rather than
 * letting somebody discover it afterwards.
 *
 * IT WRITES NOTHING. No mirror row, no assignor, no arrival, no vault event —
 * it is the same decision function the pipeline runs, over the same reads, and
 * a preview that left a trace would put a patient on a queue because a
 * receptionist changed their mind about a dropdown.
 *
 * A REFUSAL IS AN ANSWER TOO. `blocked` carries the same reason CODE the
 * pipeline would refuse with (`provider_not_servicing`, `provider_not_anchored`),
 * so the console maps it to its own words and a destination rather than
 * showing prose (CLAUDE.md §7).
 *
 * A NURSE OR A PHLEBOTOMIST IS NOT BLOCKED HERE ANY MORE (12 Sep 2026). They
 * come back as a DECISION — `none`, with `seen_by_a_practitioner_who_does_not
 * _bill` or `billing_provider_not_yet_named` — because that is what the
 * pipeline will record, and a preview that disagreed with the thing it previews
 * would be worse than no preview at all.
 */
export interface ArrivalPreview {
  /** Null when `blocked` — nothing could be decided, and that is why. */
  readonly decision: {
    readonly type: 'enduring' | 'episodic_pre' | 'none';
    readonly reason: string;
  } | null;
  /** Hard rule 14: which table would decide. Empty when blocked. */
  readonly policyVersion: string;
  /** Who the agreement would name, so the line can read "with Dr X". */
  readonly providerName: string | null;
  /** The practice's own label for the site, where the practice has more than one. */
  readonly locationLabel: string | null;
  /**
   * The agreement that already covers this practitioner and patient, when the
   * answer is `none` — so "nothing to sign" links to the thing that says so
   * rather than asserting it (CLAUDE.md §7).
   */
  readonly coveringAgreementId: string | null;
  /** The reason code the pipeline would refuse with, and the role that caused it. */
  readonly blocked: {
    readonly reason: ArrivalRefusalReason | string;
    readonly billingRole: string | null;
  } | null;
}

/**
 * ONE PATIENT THIS PRACTICE ALREADY HOLDS, FOUND BY TYPING A NAME (W2).
 *
 * FOUR FIELDS, AND THE SHORTNESS IS THE POINT. This platform is not a patient
 * directory (REQ-DATA-10) and the endpoint behind this refuses to answer
 * "everybody" — it needs a term, it caps what it returns, and what it returns
 * is what a receptionist needs to tell two people with one name apart and to
 * carry the join key forward. No address, no contact detail, no history. Never
 * a Medicare card number, which is not an identity identifier and is not held
 * in this platform at all (hard rule 1, REQ-VER-02).
 */
export interface PatientSearchResult {
  readonly patientId: string;
  readonly givenNames: string;
  readonly familyName: string;
  /** YYYY-MM-DD. The one detail that separates two people who share a name. */
  readonly dateOfBirth: string;
  /**
   * The practice's own handle — the join key an arrival is matched on.
   *
   * NULL IS POSSIBLE AND IS NOT A BUG. The column is nullable because a
   * patient can reach this platform by a route that never carried one (a
   * portal invitation, an older sync). An arrival REQUIRES one, so the form
   * asks for it when the person it found has none — which is the moment the
   * practice's own number finally lands on the record.
   */
  readonly patientRecordNumber: string | null;
}

/**
 * THE SERVICE HAS BEEN RENDERED — what the platform did about it (Carl,
 * 11 Sep 2026; TODO.md "Two front doors" decision (b), "Still to build:
 * Post-service push").
 *
 * The second moment on the same desk. The patient has seen the practitioner,
 * the practice's software says what was done, and the versioned post-service
 * table decides whether a second signature is owed. The answer comes back in
 * the response for exactly the reason an arrival's does: the connector's
 * author should be able to see the platform disagreeing with their assumption
 * rather than guessing.
 *
 * NO AMOUNT ANYWHERE ON THIS SHAPE (hard rule 4). A rendered service carries a
 * date and item numbers; the benefit is not in the s 65C data set and adding
 * it is risk.
 */
export interface ServiceRenderedReceipt {
  readonly serviceRecordId: string;
  readonly patientId: string;
  readonly decision: {
    readonly outcome: 'covered' | 'covered_by_enduring' | 'episodic_post';
    readonly reason: string;
  };
  /**
   * The post-agreement drafted for this service. NULL on both `covered`
   * answers — nothing was drafted, and that is the answer.
   */
  readonly agreementId: string | null;
  /**
   * WHAT SAYS THE PATIENT OWES NOTHING, so the queue line can LINK to it
   * rather than assert it (CLAUDE.md section 7). Null on `episodic_post`.
   */
  readonly coveringAgreementId: string | null;
  /** Hard rule 14: the version of the table that decided. */
  readonly policyVersion: string;
  /** True on a retry: this service had already been processed. */
  readonly repeat: boolean;
}

/**
 * SOMEBODY BOOKED FOR TODAY WHO HAS NOT WALKED IN YET (Carl, 12 Sep 2026;
 * FRONT-DESK-PAGE.md §12.4).
 *
 * WHY THIS SHAPE IS SO SMALL, AND WHY THAT IS THE POINT. It feeds the
 * "Expected" group of the front desk's queue rail, and that rail carries a
 * name, a time and nothing else — it stands at a counter facing a waiting
 * room, which is the same reasoning that keeps the waiting list off the
 * tablet. No provider, no reason, no condition, no date of birth, no contact
 * detail, no identifier of any kind (hard rules 1 and 9), and no amount (hard
 * rule 4). A field added here is a field on a screen the public can read over
 * a shoulder.
 *
 * NOTHING HERE IS ACTIONABLE, DELIBERATELY. A person who has not arrived
 * cannot sign, so the row carries no agreement, no session and no control. It
 * exists so a beginner can see the shape of the morning and so an empty "Here
 * now" does not read as "nothing to do today".
 *
 * THE LIST IS ROUTINELY EMPTY AND THAT IS NOT A FAULT. Appointments reach us
 * only when the practice's software pushes them, which is behind blocker D-01,
 * so every caller must be able to say WHY it is empty rather than draw a blank
 * box.
 */
export interface ExpectedAppointment {
  readonly appointmentId: string;
  /** Always present: an appointment whose patient did not resolve is not listed. */
  readonly patientId: string;
  readonly patientName: string;
  /**
   * As the practice's software gave it — a local clock time, never parsed into
   * an instant here. Null where the feed carried no time, which reads as
   * "booked for today, no time given" and sorts last.
   */
  readonly time: string | null;
}

/**
 * WHO CAME IN, WHEN, TO SEE WHOM, AND WHAT HAPPENED ABOUT THEIR AGREEMENT
 * (Carl, 12 September 2026, on `/practice/frontdesk`: *"Add a button here with
 * a link to show all Patients seen at this practice today. You could put a
 * filter on this to search for any day. Default to today."*).
 *
 * A REGISTER, NOT A WORK QUEUE, and the difference decides what is on the row.
 * The front desk rail and the practitioner's waiting list both EXCLUDE the
 * finished — a signed agreement leaves the desk, because a queue is a list of
 * things to do. This is the opposite: a day that is entirely done still has a
 * full register, and a person who walked in and left is exactly who somebody
 * is looking for when they open it a week later.
 *
 * WHICH IS ALSO WHY AN UNRESOLVED ARRIVAL IS STILL A ROW. `Arrival.patientId`
 * is nullable — *"null only if resolution failed"* — and a register that
 * quietly omitted those people would be a register that was wrong without
 * saying so. The row carries the practice's own record number, which is the
 * handle reception has anyway, and `patientName` is null rather than invented.
 *
 * ONE APPROVED IDENTIFIER AND NO OTHERS (hard rule 1, REQ-VER-02). The s 65C
 * identity set is name, date of birth, gender, address, PATIENT RECORD NUMBER
 * and IHI. The record number is in it, which is why it may be here; the
 * Medicare card number is not, is not on this row, and there is no field it
 * could arrive in. No date of birth and no address either — neither is needed
 * to answer this page's question, and this screen faces a counter.
 *
 * NO AMOUNT, AND NO FIELD FOR ONE (hard rule 4).
 *
 * IT REPORTS AND IT GATES NOTHING (hard rule 8, REQ-REC-04). Every value below
 * is a statement about what already happened.
 */
export interface DayRegisterRow {
  /** The arrival — the row's identity. One patient, one day, one walk-in. */
  readonly arrivalId: string;
  /** Null where the arrival never resolved to a record on the mirror. */
  readonly patientId: string | null;
  /** Null for the same reason. The register says so rather than inventing one. */
  readonly patientName: string | null;
  /**
   * THE PRACTICE'S OWN NUMBER FOR THIS PERSON — off the mirror where the
   * arrival resolved, and off the arrival's own copy where it did not, which is
   * the handle the sender used and the only one there is.
   */
  readonly patientRecordNumber: string | null;
  /** When they walked in, ISO 8601. Formatted where it is shown, never here. */
  readonly arrivedAt: string;
  /**
   * WHO THEY CAME TO SEE (`whoTheyCameToSee`), not who the claim goes under.
   * Null where the arrival named nobody we could resolve.
   */
  readonly seenByName: string | null;
  /**
   * WHOSE AGREEMENT IT IS, WHERE THAT IS SOMEBODY ELSE
   * (ARRIVAL-WHO-IS-SEEN.md §6a). For a nurse's patient the agreement is
   * anchored on the supervising provider. Null whenever the two are the same
   * person, so a name here always marks a real difference.
   */
  readonly agreementProviderName: string | null;
  /**
   * THE NEWEST AGREEMENT IN THE CHAIN, never the one the arrival named. An
   * arrival names the HEAD; a correction supersedes it with a row the arrival
   * has never heard of, and reading the arrival's own would report "not signed"
   * for somebody who signed the successor. Null where the visit needed none.
   */
  readonly agreementId: string | null;
  readonly agreementStatus: string | null;
  /**
   * SIGNED MEANS THE SIGNATURE EVENT EXISTS — a link in the non-repudiation
   * chain, never a status column somebody could set by hand.
   */
  readonly agreementSigned: boolean;
  /**
   * WHERE THE VISIT GOT TO, if anybody said (`content/visit-states.json`).
   * A KEY, never a word: the list is versioned content and the labels live in
   * the string table keyed by it (CLAUDE.md §7). Null when nobody recorded one,
   * which is honest and is not a warning.
   */
  readonly visitState: string | null;
}

/**
 * ONE PRACTICE'S DAY.
 *
 * IT SAYS WHICH DAY IT ANSWERED AND IN WHOSE CLOCK. The caller may send no
 * date at all, and "today" is then the SERVER's answer — so a page that assumed
 * its own would be a page that could head a register with the wrong date for
 * ten hours a day.
 */
export interface DayRegister {
  /** `YYYY-MM-DD`, in `timezone`. */
  readonly date: string;
  /** The zone the day was measured in (`PRACTICE_TIMEZONE`). */
  readonly timezone: string;
  /** Arrival order, which is reception's order. Nothing re-sorts it. */
  readonly rows: readonly DayRegisterRow[];
}

// ---------------------------------------------------------------------------
// MOVING A PRACTITIONER'S LIST TO SOMEBODY ELSE (Carl, 12 September 2026:
// *"the assigned practioner has called in sick... select the patients and then
// select a practioner to move them to"*).
// ---------------------------------------------------------------------------

/**
 * WHY A ROW COULD NOT BE MOVED — a CODE the console maps to words and a
 * destination, never prose (CLAUDE.md §7, "shortcuts to the answer").
 *
 * PARTIAL FAILURE IS NEVER SILENT (TODO.md "Moving a practitioner's whole
 * list" §5). Twelve moved and three refused reports all three, with the reason
 * against the row it was about, and applies the twelve.
 *
 *  - `arrival_not_found` — no such visit inside this practice's scope. It is
 *    what an arrival belonging to ANOTHER practice reads as, because RLS never
 *    returns the row: the move fails closed and says nothing about whose it
 *    was.
 *  - `arrival_not_received` — the arrival was refused and is waiting for a
 *    provider to be named. That is a different fix, on a different list.
 *  - `already_with_that_practitioner` — the patient is already here to see the
 *    person they would be moved to. Nothing is written and nothing is
 *    superseded; a second press of the same button is not a second move.
 *  - `target_cannot_be_a_provider` — the person chosen is recorded at that
 *    location as somebody the claim does not go under (a nurse, a
 *    phlebotomist). `mayBeProviderOnAgreement`, unchanged, and a list cannot
 *    widen it.
 *  - `target_not_at_that_location` — D4 is the person AND the place of
 *    practice (s 65C(5)(a)), and billing identity is practice × location ×
 *    practitioner (D-2026-09-12-09). Somebody with no live affiliation at the
 *    site the patient walked into cannot be named on their agreement.
 *  - `no_location_on_the_arrival` — the arrival never resolved to a
 *    practitioner at a location, so there is no place to match a target
 *    against. Nothing is guessed.
 *  - `agreement_not_moved` — the row's own agreement could not be superseded
 *    (it had already been superseded by somebody else's press, or the
 *    replacement could not be created). The arrival is left exactly where it
 *    was: an agreement naming one practitioner and an arrival naming another
 *    is the one state this must never produce.
 *  - `move_failed` — something else went wrong before anything was written.
 *    Nothing about this patient changed and nothing about the others was
 *    affected: one row's failure never aborts the press (hard rule 8).
 *  - `move_not_recorded` — THE HALF-DONE ONE, and it is named rather than
 *    hidden. The agreement was superseded and the visit's own row was then not
 *    updated, so the two disagree about who this patient is seeing. Pressing
 *    Move again for that patient settles it: the retry finds an agreement that
 *    already names the target, supersedes nothing further, and writes the row.
 *    A code that said "not moved" would send the desk looking for a problem in
 *    the wrong place.
 */
export const ARRIVAL_MOVE_REFUSALS = [
  'arrival_not_found',
  'arrival_not_received',
  'already_with_that_practitioner',
  'target_cannot_be_a_provider',
  'target_not_at_that_location',
  'no_location_on_the_arrival',
  'agreement_not_moved',
  'move_failed',
  'move_not_recorded',
] as const;
export type ArrivalMoveRefusal = (typeof ARRIVAL_MOVE_REFUSALS)[number];

/**
 * WHAT HAPPENED TO ONE PATIENT. Ids and facts — no name, no identifier value,
 * no amount (hard rules 1, 4 and 9); the console already holds the names it
 * put on screen and joins them by `arrivalId`.
 */
export interface ArrivalMoveOutcome {
  readonly arrivalId: string;
  readonly moved: boolean;
  /** Null exactly when `moved`. */
  readonly refusedReason: ArrivalMoveRefusal | null;
  /**
   * THE AGREEMENT THAT NAMED THE PRACTITIONER THEY ARE LEAVING. It is NOT
   * touched — no edit, no void, no annotation (hard rule 11, HARD-02); it is
   * superseded by one naming the new practitioner, and it stays a true record
   * of what was agreed before the day overtook it.
   */
  readonly supersededAgreementId: string | null;
  /** The successor, naming the new practitioner. Null where the visit needs none. */
  readonly newAgreementId: string | null;
  /**
   * THEY HAD ALREADY SIGNED, SO THEY MUST SIGN AGAIN (Carl, 12 Sep 2026:
   * *"the patient will have to resign a new agreement when they come in"*).
   *
   * AT THE DESK, WHEN THEY COME IN — they are already on their way, so no
   * message goes out and no remote signature is asked for. This flag is what
   * the desk acts on, and it is the whole difference between the signed case
   * and the unsigned one: the mechanism is identical.
   */
  readonly needsANewSignature: boolean;
  /**
   * WHAT THE VISIT NEEDS NOW, RE-ASKED OF THE VERSIONED POLICY (hard rules 6
   * and 14). An ongoing agreement is per practitioner × patient and does not
   * travel, so the old answer is never carried across. `none` is a real
   * answer: the new practitioner may already hold one with this patient.
   */
  readonly visitDecision: 'enduring' | 'episodic_pre' | 'none' | null;
  readonly policyVersion: string | null;
}

/**
 * ONE PRESS OF "MOVE THESE PATIENTS", ANSWERED IN FULL.
 *
 * IT NEVER BLOCKS CARE (hard rule 8, REQ-REC-04). Every patient in this list is
 * seen exactly as they would have been; what moves is the paperwork, and a
 * refusal slows the evidence rather than the service.
 */
export interface ArrivalMoveResult {
  readonly toAffiliationId: string;
  readonly movedCount: number;
  readonly refusedCount: number;
  /** How many of the moved must sign again at the desk. */
  readonly needsANewSignatureCount: number;
  /** Every row asked about, in the order they were asked. */
  readonly outcomes: readonly ArrivalMoveOutcome[];
}
