import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AUTHORITY_BASES_FOR_ANOTHER, MAX_SIGNATURE_RASTER_BYTES } from '@aobplatform/domain';

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
  /**
   * WHAT THE PERSON SAID THEY ARE, in their own vocabulary — "Grandparent",
   * "Carer", "Friend" — as against `authorityBasis`, which is reg 65CB(5)'s.
   *
   * REQ-VUL-01 NAMES THEM AS SEPARATE ATTRIBUTES and they are: the basis is
   * the legal ground for acting, the relationship is the fact C8 prints on the
   * agreement. The tablet derives the basis from the relationship through
   * versioned content (`@aobplatform/domain`'s `authorityBasisFor`) and sends
   * BOTH, so the record keeps the words the person actually chose rather than
   * only the category we filed them under.
   *
   * OPTIONAL, because every caller that predates the kiosk's dropdown omits it
   * and `buildAssignorForAnother` still derives a relationship from the basis
   * (`RELATIONSHIP_BY_BASIS`). Supplying it overrides that derivation with the
   * more specific answer; omitting it changes nothing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  relationship?: string;

  /**
   * WHICH VERSION OF THE RELATIONSHIP LIST PRODUCED THAT ANSWER (hard rule 14).
   * Not a column: it is recorded on the vault event, where it belongs — a
   * question asked months later is "what were they offered when they chose",
   * and that is evidence, not current state.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationshipsVersion?: string;

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

/**
 * One captured point of a drawn signature.
 *
 * KEPT EXACTLY AS THE POINTER EVENT DELIVERED IT — no rounding here and no
 * smoothing anywhere downstream. The timing is a signal the record stores and
 * never judges; see `packages/domain/src/signature.ts` for why, and for why no
 * biometric template is derived from any of this.
 */
export class SignaturePointDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  /** Milliseconds since the first point of the first stroke. Never a wall clock. */
  @IsNumber()
  t!: number;

  /** Reported pressure, absent entirely on devices that report none. */
  @IsOptional()
  @IsNumber()
  p?: number;
}

export class SignatureStrokeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SignaturePointDto)
  points!: SignaturePointDto[];
}

/**
 * The drawn mark itself (REQ-SIG-01: vector + raster).
 *
 * THE PAD'S LOGICAL SIZE TRAVELS WITH THE POINTS, because the coordinates mean
 * nothing without it — a pad swapped for a larger one next year would
 * otherwise reinterpret every stroke ever stored.
 *
 * The size caps and the "is this really a PNG" test live in the domain
 * (`assertSignatureCaptureAcceptable`), applied to the DECODED bytes: base64
 * understates its own size by a third, so a cap written here would be a cap on
 * the wrong number.
 */
export class DrawnSignatureDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SignatureStrokeDto)
  vector!: SignatureStrokeDto[];

  /** Base64 PNG. A `data:` URL prefix is tolerated and stripped. */
  @IsString()
  @MaxLength(Math.ceil((MAX_SIGNATURE_RASTER_BYTES * 4) / 3) + 64)
  rasterPngBase64!: string;

  @IsNumber()
  padWidth!: number;

  @IsNumber()
  padHeight!: number;
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

  /**
   * ADDITIVE AND OPTIONAL HERE, MANDATORY IN THE DOMAIN. Every caller that
   * predates this field keeps working — the remote link signs by
   * tap-to-approve (REQ-SIG-01) and sends nothing — while
   * `assertSignatureCaptureAcceptable` refuses a `drawn` signature that
   * arrives without one, and refuses one sent with any other method. The
   * coupling is a rule about two fields, so it lives where a rule can be
   * tested (`drawn_signature_requires_strokes`) rather than in a decorator
   * that only this class would honour.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => DrawnSignatureDto)
  signature?: DrawnSignatureDto;

  /**
   * THE STATEMENTS THE ASSIGNOR TICKED — keys, never sentences (Carl, 5 Sep
   * 2026; W1). `episodic_assign_v1`, and so on: the words live in the template
   * the agreement records, and a client that could send its own text could
   * send text nobody agreed to.
   *
   * OPTIONAL HERE, MANDATORY IN THE SERVICE, for the reason `signature` gives:
   * the coupling is a rule about the agreement's own template rather than
   * about this class, so it lives where a rule can be tested
   * (`signature_requires_every_statement_affirmed`). Callers that predate the
   * statements — and agreements locked before them — are unaffected.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  affirmations?: string[];
}
