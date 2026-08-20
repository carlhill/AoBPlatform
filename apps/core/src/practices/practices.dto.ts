import { Type } from 'class-transformer';
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
