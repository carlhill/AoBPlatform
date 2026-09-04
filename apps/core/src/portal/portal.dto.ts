import { IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * WHAT THE PORTAL WILL ACCEPT — and, more importantly, what it will not.
 *
 * `whitelist: true` on the global pipe strips anything not declared here, which
 * is doing real work on this surface: a body that arrives carrying a Medicare
 * number, a replacement address or a practice id the caller chose never reaches
 * a service. Adding a field to one of these classes is therefore a decision,
 * not a convenience.
 */
export class ActivatePortalDto {
  @IsUUID()
  agreementId!: string;

  @IsString()
  @MinLength(40)
  activationToken!: string;

  /**
   * The stated identifiers, keyed by approved type. NOT typed as a fixed shape,
   * because the set is per practice (REQ-VER-06, floor of three) — but every
   * key is checked against the approved set before anything is compared, so a
   * `medicare_number` key is a 400 rather than a silently ignored extra
   * (hard rule 1).
   *
   * The values live only inside the comparison. Nothing below stores or logs
   * one (REQ-VER-04).
   */
  @IsObject()
  stated!: Record<string, string>;
}

export class CorrectionRequestDto {
  @IsUUID()
  practiceId!: string;

  /**
   * One of the five detail types. THERE IS NO FIELD FOR A NEW VALUE and there
   * must never be one: reception confirms the right value with the patient in
   * person and types it into the PMS, which is the master (REQ-DATA-10). A
   * portal that accepted a replacement would be an unverified channel writing
   * into a clinical system.
   */
  @IsString()
  @MinLength(1)
  fieldType!: string;
}

/** Dev only. See `PortalDevController` for why it exists and what it refuses. */
export class DevPortalSessionDto {
  @IsUUID(undefined, { each: true })
  patientIds!: string[];

  /**
   * WHICH PRACTICES TO LOOK IN, and why the caller has to say.
   *
   * The service connects as `aob_app`, which holds neither SUPERUSER nor
   * BYPASSRLS — only the migration role does. So a patient id cannot be
   * resolved to its practice without already being inside that practice's
   * scope, in development exactly as in production. A dev endpoint that could
   * defeat that would be worth more to an attacker than it is to us, so it asks
   * instead: the practices to search, or the `x-practice-id` header when there
   * is only one.
   */
  @IsOptional()
  @IsUUID(undefined, { each: true })
  practiceIds?: string[];
}
