import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ARRIVAL_SOURCES } from '@aobplatform/contracts';
import { AUTHORITY_BASES_FOR_ANOTHER, SERVICE_DESCRIPTIONS } from '@aobplatform/domain';

/**
 * THE DOOR IS WHERE DATA MINIMISATION IS ENFORCED — the same posture the print
 * job envelope takes (`inbound-print-jobs.controller.ts`). These fields are
 * exactly what an arrival may carry, and the global ValidationPipe runs with
 * `whitelist: true`, so anything else is stripped before it is looked at.
 *
 * TWO FIELDS HAVE NO PLACE TO LAND, AND BOTH ABSENCES ARE THE POINT.
 *
 * NO MEDICARE NUMBER. The card number is not an identity identifier and the
 * exclusion is non-configurable (hard rule 1, REQ-VER-02, HARD-03). Stripping
 * it silently would teach the connector's author nothing, so the service
 * refuses any key matching /medicare/i OUT LOUD, exactly as
 * `PATCH /patients/:id/details` does. Named test:
 * `arrival_rejects_a_medicare_number`.
 *
 * NO AGREEMENT TYPE. What the visit needs — a first enduring agreement, an
 * episodic pre-agreement, or nothing because one already covers this provider
 * — is decided by the versioned visit policy in `@aobplatform/domain`, never by
 * the sender (hard rules 6 and 14). A PMS that could assert `enduring` would be
 * a PMS holding a mapping we cannot version, in a system we do not control.
 * Named test: `arrival_type_is_decided_by_the_rule_set_not_the_pms`.
 *
 * AND NO PRACTICE ID. Scope comes from the request — the `x-practice-id` header
 * in dev, the connector's mTLS identity when that lands — and RLS enforces it
 * at the database. A body that could name its own practice would be a body that
 * could write into another practice's records.
 */
/**
 * SOMEBODY OTHER THAN THE PATIENT IS SIGNING, SAID AT THE DESK (D7, hard rule
 * 10; W2, Carl 7 Sep 2026).
 *
 * SAME SHAPE AS `ChangeAssignorDto`, ON PURPOSE — because it IS that request.
 * The arrival hands this straight to `AgreementsService.changeAssignor` before
 * the particulars are locked, so `buildAssignorForAnother` runs the identical
 * refusals it always did: practice staff hard-blocked against the staff list
 * (REQ-VUL-04, fail closed), a declaration of full age (REQ-AGE-01), a usable
 * contact channel (REQ-REG-08), a basis from the fixed list. There is no
 * second copy of hard rule 10 in this module and there must never be one.
 *
 * NO DATE OF BIRTH, HERE OR ANYWHERE. What is recorded is a DECLARATION,
 * never verified and never stored as a birth date (REQ-AGE-01, REQ-VUL-02) —
 * the same answer the kiosk's K-5 screen and the tablet desk's "who is
 * signing" panel both take. And no capacity question, because no surface in
 * this platform asks staff to judge whether a patient can consent
 * (REQ-VUL-05); the absence is the requirement.
 */
export class ArrivalAssignorDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  /**
   * THE WORD THE PERSON CHOSE, from `assignor-relationships.json`. C8 prints
   * it; REQ-VUL-01 keeps it as an attribute separate from the legal basis.
   */
  @IsString()
  @MaxLength(80)
  relationship!: string;

  /** Which list produced it (hard rule 14). Recorded on the vault event. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationshipsVersion?: string;

  /** reg 65CB(5)'s category, derived from the relationship through that list. */
  @IsIn(AUTHORITY_BASES_FOR_ANOTHER as unknown as string[])
  authorityBasis!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * REQ-AGE-01. Present AND true, or the party is refused — a body that simply
   * omits it must never read as consent to the claim.
   */
  @IsBoolean()
  declaresEighteenOrOver!: boolean;

  /** Contact, never identity (C7.2 / REQ-REG-08). The domain requires one of these. */
  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
}

export class ArrivalDto {
  /** The practice's own handle for this patient — the join key for our mirror. */
  @IsString()
  @MaxLength(100)
  pmsPatientRecordNumber!: string;

  // The five details, as the PMS holds them right now. The PMS is the source of
  // truth (REQ-DATA-10); an arrival is the moment our mirror is refreshed.
  @IsString() @MaxLength(200) familyName!: string;
  @IsString() @MaxLength(200) givenNames!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth!: string;
  @IsString() @MaxLength(500) address!: string;

  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;

  /**
   * WHICH PRACTITIONER, AT WHICH LOCATION — any ONE of these, and the service
   * refuses an arrival with none of them. An enduring agreement is per
   * practitioner × patient (hard rule 6, REQ-END-01) and a provider number is
   * per practitioner per location (FR-1.8), so an arrival that cannot name the
   * person and the place is an arrival that cannot be decided at all.
   *
   * `affiliationId` is the direct form. `practitionerId` + `locationId` is the
   * same fact for a sender that holds them separately. `providerNumber` names
   * both by itself, which is why `arrive.sh` uses it and why it is the
   * likeliest thing a PMS actually holds.
   */
  @IsOptional() @IsUUID() affiliationId?: string;
  @IsOptional() @IsUUID() practitionerId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() @MaxLength(20) providerNumber?: string;

  /**
   * DEPRECATED — REMOVE AFTER 30 NOVEMBER 2026 (Carl, 7 Sep 2026).
   *
   * The practice-wide `providers` row, which is the anchor this build retired.
   * Accepted for one release and resolved to the affiliation it can be matched
   * to; an arrival whose provider matches no practitioner at a location is
   * REFUSED with `provider_not_anchored` rather than anchored on a guess.
   */
  @IsOptional() @IsUUID() providerId?: string;

  /** When they arrived, by the practice's clock rather than ours. */
  @IsISO8601()
  arrivedAt!: string;

  @IsIn(ARRIVAL_SOURCES as unknown as string[])
  source!: string;

  /**
   * The sender's own handle for this arrival. A connector on a practice's ADSL
   * retries, and one walk-in must never become two agreements and two rows on
   * reception's queue.
   */
  @IsString()
  @MaxLength(200)
  idempotencyKey!: string;

  // -------------------------------------------------------------------------
  // THE THREE FIELDS ONLY A PERSON MAY SEND (W2, Carl 7 Sep 2026).
  //
  // Every one of them is an answer somebody at the desk gives. A connector has
  // nobody to ask — which is precisely why the practice's default D6a exists
  // and why the patient is their own assignor on a machine push — so the
  // service REFUSES all three out loud under any source but `reception`
  // (`assertNothingForbiddenWasSent`). They are optional even then: a typed
  // arrival that answers none of them behaves exactly like a connector's.
  // -------------------------------------------------------------------------

  /**
   * D5 — the day the service is for, when it is not the day this was typed.
   *
   * A PLAIN DATE, NOT A TIMESTAMP, and that is not a style choice: the
   * pipeline derives the service date from `arrivedAt` by taking its UTC
   * calendar day, and 9 a.m. in Sydney is the previous day in UTC. A
   * particular of a contract may not depend on which side of midnight
   * Greenwich is.
   */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) serviceDate?: string;

  /**
   * D6a — chosen from the versioned list, never typed (hard rule 14).
   *
   * `@IsIn` AGAINST THE CONTENT FILE ITSELF rather than a literal list here.
   * The rules engine's C6 check is exact and case-sensitive, so a description
   * this DTO let through that the mapping does not hold would be a lock the
   * rules engine then refuses — with the patient standing at the desk.
   */
  @IsOptional() @IsIn(SERVICE_DESCRIPTIONS as unknown as string[]) serviceDescription?: string;

  /** D7 — who is signing, when it is not the patient. See `ArrivalAssignorDto`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ArrivalAssignorDto)
  assignor?: ArrivalAssignorDto;
}

/**
 * "WHAT WOULD THIS VISIT NEED?" — asked before anything is written (W2).
 *
 * THE PROVIDER AND THE PATIENT'S RECORD NUMBER, AND NOTHING ELSE. The visit
 * policy's inputs are: is this practitioner a GP at this location, may they be
 * the provider on an agreement at all, does this patient already hold a live
 * ongoing agreement with this PERSON, and what does the practice offer by
 * default (hard rules 6 and 14). Everything else on the form — the name, the
 * address, the contact details — is irrelevant to the answer, so it is not
 * asked for: a preview that took the five details would be a read endpoint
 * that could be used to echo a patient record back at whoever typed one.
 *
 * NO IDEMPOTENCY KEY, BECAUSE NOTHING IS WRITTEN. And no source: a preview is
 * not an arrival and never becomes one.
 */
export class ArrivalPreviewDto {
  @IsString()
  @MaxLength(100)
  pmsPatientRecordNumber!: string;

  @IsOptional() @IsUUID() affiliationId?: string;
  @IsOptional() @IsUUID() practitionerId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() @MaxLength(20) providerNumber?: string;
}
