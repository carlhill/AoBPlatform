import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

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
  /** The s 65C particulars payload — validated by the rules service before locking. */
  @IsObject()
  particulars!: Record<string, unknown>;
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
