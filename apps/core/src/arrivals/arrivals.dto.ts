import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ARRIVAL_SOURCES } from '@aobplatform/contracts';

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
   * WHICH PROVIDER — one of these two, and the service refuses an arrival with
   * neither. An enduring agreement is per practitioner × patient (hard rule 6,
   * REQ-END-01), so an arrival that cannot name the provider is an arrival that
   * cannot be decided at all.
   */
  @IsOptional() @IsUUID() providerId?: string;
  @IsOptional() @IsString() @MaxLength(20) providerNumber?: string;

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
}
