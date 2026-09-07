import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `PATCH /patients/:id/details` — reception correcting a detail the patient
 * crossed on the tablet (TODO.md "Check-your-details", Carl 4 Sep 2026).
 *
 * SIX FIELDS, AND THE OMISSIONS ARE THE DESIGN.
 *
 * THERE IS NO MEDICARE FIELD AND THERE NEVER WILL BE. The card number is not
 * an identity identifier and the exclusion is non-configurable (hard rule 1,
 * REQ-VER-02); the service refuses any field whose NAME matches /medicare/i
 * before it looks at this class at all, so adding one here would be refused at
 * runtime as well as failing the ESLint rule at build time. Not storing it
 * would not rescue the idea either — the rule is about what may be USED to
 * establish identity, not only about what is retained.
 *
 * NOR GENDER, PATIENT RECORD NUMBER OR IHI. They are approved identifiers, and
 * the patient was never shown them: K-P1 asks about name, date of birth,
 * address, mobile and email. A correction control for a field nobody disputed
 * would be reception editing an identifier off the back of a screen that did
 * not mention it.
 *
 * NOR `confidentialityFlag`, `pmsLinkageKey` OR ANY LINKAGE. Those are the
 * platform's own machinery (REQ-CHILD-01 fails closed on the first), not a
 * detail a patient can be wrong about.
 *
 * EVERY FIELD IS OPTIONAL AND AT LEAST ONE IS REQUIRED — enforced in the
 * service, because "the caller sent nothing" and "the caller cleared
 * everything" must not look alike.
 */
export class CorrectPatientDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  givenNames?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  familyName?: string;

  /** ISO `yyyy-mm-dd`, as every date in this system is written. */
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** CONTACT, NEVER IDENTITY (REQ-VER-02). Correcting it never supersedes. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
}
