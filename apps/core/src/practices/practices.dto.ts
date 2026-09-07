import { Type } from 'class-transformer';
import {
  KIOSK_IDLE_TIMEOUT_MAX_SECONDS,
  KIOSK_IDLE_TIMEOUT_MIN_SECONDS,
} from '@aobplatform/domain';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class LocationDto {
  @IsString()
  address!: string;
}

export class CreatePracticeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  abn?: string;

  @IsIn(['medtech_evolution', 'other'])
  pms!: string;

  /** Drives the public-holiday calendar for 2-business-day terminations (REQ-OFF-03). */
  @IsOptional()
  @IsIn(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'])
  state?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['tyro', 'hicaps'], { each: true })
  rails?: string[];

  /** Each location carries an address — s 65C(5)(a) depends on it (FR-1.1). */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations!: LocationDto[];
}

export class UpdateConfigDto {
  /** Which identifiers to challenge — approved six only, floor 3 (REQ-VER-06). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  identifierTypes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 7) // D-05 upper option
  linkExpiryHours?: number;

  /**
   * HOW LONG A KIOSK TABLET WAITS BEFORE IT RETURNS TO THE START (Carl, 4 Sep
   * 2026). Seconds — the console shows minutes and converts, because a person
   * setting this thinks in minutes and a tablet counting down thinks in
   * seconds.
   *
   * THE BOUNDS ARE HERE, NOT ONLY ON THE INPUT. Below a minute the screen
   * resets under somebody who is still reading, which would make the ceremony
   * uncompletable and so would BLOCK CARE (hard rule 8, REQ-REC-04); above
   * half an hour the tablet is not "between patients", it is left out with
   * somebody's address on it. Both numbers come from the domain
   * (`KIOSK_IDLE_TIMEOUT_MIN_SECONDS` / `_MAX_SECONDS`) and are repeated as
   * literals here only because class-validator decorators take constants.
   */
  @IsOptional()
  @IsInt()
  @Min(KIOSK_IDLE_TIMEOUT_MIN_SECONDS)
  @Max(KIOSK_IDLE_TIMEOUT_MAX_SECONDS)
  kioskIdleTimeoutSeconds?: number;

  /**
   * WHICH AGREEMENT THE PRE-STEP OFFERS FIRST (Carl, 4 Sep 2026; GA-PLAN B6).
   *
   * A DEFAULT, NEVER A PERMISSION. Enduring is GP-only and per practitioner ×
   * patient whatever this says (hard rule 6, REQ-END-01/-01a) — those checks
   * live on the push and in the domain, where a setting cannot reach them.
   * What this decides is what a GP practice OFFERS first at the desk, and what
   * a patient who declines is offered instead.
   */
  @IsOptional()
  @IsBoolean()
  enduringByDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  writeBackProven?: boolean;

  @IsOptional()
  @IsBoolean()
  senderIdRegistered?: boolean;
}

export class CreateStaffDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsIn(['front_desk', 'practice_manager', 'principal'])
  role!: string;
}

export class CreateProviderDto {
  @IsString()
  name!: string;

  @IsIn(['general_practitioner', 'specialist', 'allied_health', 'nurse_practitioner', 'optometrist', 'other'])
  providerType!: string;

  @IsOptional()
  @IsString()
  placeOfPracticeAddress?: string;

  /** NOT mandatory — s 65C(5)(a) OR (b) (REQ-REG-02). */
  @IsOptional()
  @IsString()
  providerNumber?: string;

  @IsOptional()
  @IsString()
  ahpraNumber?: string;
}

export class CreateAssignorDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  relationshipToPatient?: string;

  @IsIn(['self', 'parent', 'spouse', 'co_resident_relative_18_plus', 'guardian', 'health_epoa', 'other_with_note'])
  authorityBasis!: string;

  @IsOptional()
  @IsString()
  authorityNote?: string;
}
