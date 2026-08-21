import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PERSON_VERIFICATION_METHODS } from '@aobplatform/domain';

/**
 * REQ-PKI-01 — recording the three checks a human performed before a passkey
 * may be bound. Every field is an assertion by a named person, not a system
 * lookup: FR-1.11 scopes v1 as "existence check manual at onboarding,
 * automated re-verification is roadmap". What the platform guarantees is that
 * someone named attested, freshly, and that the record cannot be edited after.
 */
export class RecordCeremonyDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  /** Check 1 — AHPRA registration number, format-validated (FR-1.11). */
  @IsString()
  ahpraNumber!: string;

  /** Attested as CURRENT — not merely that a number exists. */
  @IsBoolean()
  ahpraRegistrationCurrent!: boolean;

  /** Check 2 — the provider number AND the place of practice it is valid for. */
  @IsString()
  providerNumber!: string;

  @IsString()
  @MinLength(1)
  providerNumberLocation!: string;

  @IsBoolean()
  providerNumberVerified!: boolean;

  /** Check 3 — the person. Video or in person; an emailed link proves nothing. */
  @IsIn(PERSON_VERIFICATION_METHODS as unknown as string[])
  personVerificationMethod!: string;

  /** The named human who did the checks. Never "system", never blank. */
  @IsString()
  @MinLength(1)
  verifiedByName!: string;

  /** Their platform identity where they have one — self-attestation is blocked on this. */
  @IsOptional()
  @IsUUID()
  verifiedByStaffId?: string;

  @IsOptional()
  @IsString()
  evidenceNote?: string;

  /** REQ-PKI-05 — required when this authorises a RE-enrolment (recovery). */
  @IsOptional()
  @IsBoolean()
  steppedUp?: boolean;
}
