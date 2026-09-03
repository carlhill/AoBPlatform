import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AUTHORITY_BASES_FOR_ANOTHER } from '@aobplatform/domain';

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

/**
 * `POST /agreements/:id/assignor` — somebody other than the patient is
 * signing, or the patient is after all.
 *
 * D7 IS THE DISCRIMINATOR AND IT IS NEVER INFERRED (CLAUDE.md §3). Send
 * `{ assignorIsPatient: true }` on its own to put the agreement back on the
 * patient; everything below applies only to the other branch, which is why
 * each field is gated on the flag rather than being optional in general — a
 * field that is optional in general is a field the server has to guess about.
 *
 * WHAT IS NOT HERE: any question about capacity (REQ-VUL-05), any date of
 * birth for the assignor (REQ-AGE-04 — the input is a DECLARATION), and any
 * evidence of the claimed authority, which reg 65CB(5) makes self-declared
 * and the platform therefore records rather than verifies (REQ-VUL-02).
 */
export class ChangeAssignorDto {
  /** D7 — explicit, never inferred. */
  @IsBoolean()
  assignorIsPatient!: boolean;

  @ValidateIf((o: ChangeAssignorDto) => o.assignorIsPatient === false)
  @IsString()
  @MaxLength(200)
  name!: string;

  /**
   * The fixed list from REQ-VUL-01, imported rather than retyped — `self` is
   * absent because it is not an authority to act for anybody.
   */
  @ValidateIf((o: ChangeAssignorDto) => o.assignorIsPatient === false)
  @IsIn(AUTHORITY_BASES_FOR_ANOTHER as unknown as string[])
  authorityBasis!: string;

  /** Required when the basis is `other_with_note`. "friend" is a legitimate note. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * REQ-AGE-01. The declaration must be present AND true: a body that simply
   * omits it must not read as consent to the claim.
   */
  @ValidateIf((o: ChangeAssignorDto) => o.assignorIsPatient === false)
  @IsBoolean()
  declaresEighteenOrOver!: boolean;

  /**
   * C7.2 / REQ-REG-08 — at least one of these, checked in the domain rather
   * than here so the rule holds for every caller. CONTACT, never identity: a
   * mobile number is not one of the six approved identifiers (hard rule 1).
   */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
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
