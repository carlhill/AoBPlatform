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
 * test suites. Recorded on the row because "a real practice's software said
 * this" and "somebody ran a script" must never look alike in the evidence.
 */
export const ARRIVAL_SOURCES = ['connector', 'dev'] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

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
   * WHICH PROVIDER, AND IT IS NOT OPTIONAL BETWEEN THE TWO OF THEM. An
   * enduring agreement is per practitioner × patient (hard rule 6), so an
   * arrival that cannot name the provider cannot be decided at all. Either our
   * own provider id, or the provider number the practice's software knows.
   */
  readonly providerId?: string;
  readonly providerNumber?: string;

  /** When they arrived, by the practice's clock. */
  readonly arrivedAt: IsoTimestamp;

  readonly source: ArrivalSource;

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
  readonly providerId: string | null;
  readonly providerName: string | null;
  /** The role that refused them, so the sentence on screen can name it. */
  readonly billingRole: string | null;
  /** ISO-8601, as the row holds it. Plain `string` — this shape crosses to a browser. */
  readonly arrivedAt: string;
  readonly source: ArrivalSource;
}

/** A servicing provider reception may choose instead. */
export interface ArrivalProviderChoice {
  readonly providerId: string;
  readonly name: string;
  readonly providerType: string;
}
