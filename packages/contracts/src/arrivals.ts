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
   * THE SENDER'S OWN HANDLE FOR THIS ARRIVAL. A connector that retries — and
   * a connector on a practice's ADSL will retry — must not put the same person
   * on the queue twice with two agreements to sign. The platform is idempotent
   * on (practiceId, idempotencyKey): a repeat returns the first result and
   * writes nothing.
   */
  readonly idempotencyKey: string;
}

/** What the platform did about it. */
export interface ArrivalReceipt {
  readonly arrivalId: string;
  readonly patientId: string;
  readonly decision: {
    readonly type: 'enduring' | 'episodic_pre' | 'none';
    readonly reason: string;
  };
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
   * The person named cannot be the provider on an agreement at this location:
   * their billing role is `works_under_provider` or `not_billable`. The claim
   * — and therefore the assignment — goes under somebody else's number, and
   * reception picks who.
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
