import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAgreementDto {
  @IsIn(['episodic_pre', 'episodic_post', 'treatment_plan', 'enduring'])
  type!: 'episodic_pre' | 'episodic_post' | 'treatment_plan' | 'enduring';

  @IsOptional()
  @IsIn(['mymedicare', 'residential_aged_care', 'accho_ams'])
  enduringPathway?: 'mymedicare' | 'residential_aged_care' | 'accho_ams';

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @IsUUID()
  patientId!: string;

  @IsUUID()
  assignorId!: string;

  /** D7 — explicit, never inferred. */
  @IsBoolean()
  assignorIsPatient!: boolean;
}

export class LockParticularsDto {
  /**
   * The client supplies ONLY what the server cannot know; every other
   * particular (patient name, provider details, D7, verification state) is
   * snapshotted from the platform's own records at lock time (REQ-DATA-11:
   * cache the person, snapshot the agreement) — a client can never assert a
   * fact the server owns.
   */
  @IsString()
  serviceDate!: string;

  @IsOptional()
  @IsString()
  agreementDate?: string;

  /** D6a — pre-agreements. */
  @IsOptional()
  @IsString()
  basicServiceDescription?: string;

  /** D6b — post-agreements. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mbsItemNumbers?: string[];
}

export class TransitionDto {
  @IsString()
  to!: string;
}

export class SignDto {
  @IsIn(['drawn', 'tap_to_approve', 'typed_name', 'wet_ink_scan', 'verbal_recorded'])
  method!: string;

  @IsIn(['in_practice', 'sms_link', 'email_link', 'portal', 'paper'])
  channel!: string;

  @IsOptional()
  @IsUUID()
  captureRequestId?: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
