-- RE-POINTING A DRAFT AGREEMENT AT SOMEBODY OTHER THAN THE PATIENT.
--
-- The kiosk drafts every episodic_pre with assignorIsPatient = true, which is
-- right most of the time and wrong once a morning: a parent has brought a
-- child, a spouse or a carer is signing. Nothing could move a draft onto a
-- different assignor, so the tablet handed over to the desk.
--
-- Four columns, all nullable, no backfill, nothing rewritten:
--
--   assignors.authorityDeclaredAt   REQ-VUL-02 — reg 65CB(5) makes authority a
--                                   SELF-DECLARATION. This records that one was
--                                   made and when. It is never verified, and
--                                   capacity is never asked about (REQ-VUL-05).
--   assignors.declaredOfFullAgeAt   REQ-AGE-01 — the on-screen declaration that
--                                   somebody acting for another is of full age.
--                                   A timestamp of a DECLARATION, never a date
--                                   of birth (REQ-AGE-04).
--   assignors.preferredChannel      C7.2 — per ASSIGNOR, not per patient,
--                                   because the signer is not always the
--                                   patient and the copy goes to the signer.
--   agreements.patientAssignorId    Who the agreement pointed at while the
--                                   patient was signing for themselves, so
--                                   reverting is exact rather than a name match.
--
-- REVERSIBLE. Nothing here is destructive; the rollback is at the foot of this
-- file, commented, and drops exactly what is added.
--
-- Written to be applied twice (DEV-LOOP.md).

ALTER TABLE "assignors" ADD COLUMN IF NOT EXISTS "authorityDeclaredAt" TIMESTAMP(3);
ALTER TABLE "assignors" ADD COLUMN IF NOT EXISTS "declaredOfFullAgeAt" TIMESTAMP(3);
ALTER TABLE "assignors" ADD COLUMN IF NOT EXISTS "preferredChannel" TEXT;

ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "patientAssignorId" UUID;

DO $$
BEGIN
  -- THE FIXED LIST FROM REQ-VUL-01, in the column definition rather than only
  -- in a validator. The list is statutory (reg 65CB(5)), not a preference, and
  -- a basis nobody recognises is worse than a missing one: it reads as though
  -- somebody's authority was recorded when nothing about it was.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignors_authority_basis_known') THEN
    ALTER TABLE "assignors" ADD CONSTRAINT assignors_authority_basis_known
      CHECK ("authorityBasis" IN (
        'self', 'parent', 'spouse', 'co_resident_relative_18_plus',
        'guardian', 'health_epoa', 'other_with_note'));
  END IF;

  -- "Other" WITHOUT THE NOTE IS NOT AN AUTHORITY BASIS, it is a shrug. The
  -- note IS the basis on that branch — and "friend" is a perfectly good one:
  -- the platform does not judge who a patient chooses to bring with them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignors_other_basis_has_note') THEN
    ALTER TABLE "assignors" ADD CONSTRAINT assignors_other_basis_has_note
      CHECK ("authorityBasis" <> 'other_with_note'
             OR length(trim(coalesce("authorityNote", ''))) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignors_preferred_channel_known') THEN
    ALTER TABLE "assignors" ADD CONSTRAINT assignors_preferred_channel_known
      CHECK ("preferredChannel" IS NULL OR "preferredChannel" IN ('mobile', 'email'));
  END IF;

  -- A PREFERENCE FOR A CHANNEL WE HAVE NO ADDRESS ON is a silent dead letter:
  -- every sender honours the preference (C7.2), so a preference pointing at an
  -- empty column means the copy and the reminders go nowhere and nothing says
  -- so. The column cannot hold that state.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignors_preferred_channel_reachable') THEN
    ALTER TABLE "assignors" ADD CONSTRAINT assignors_preferred_channel_reachable
      CHECK ("preferredChannel" IS NULL
             OR ("preferredChannel" = 'mobile' AND "contactMobile" IS NOT NULL)
             OR ("preferredChannel" = 'email'  AND "contactEmail"  IS NOT NULL));
  END IF;
END
$$;

-- The remembered assignor is a real assignor of this practice. ON DELETE
-- RESTRICT like every other reference to the table: assignors are not deleted,
-- and a dangling pointer here would make a revert silently impossible.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreements_patientAssignorId_fkey') THEN
    ALTER TABLE "agreements" ADD CONSTRAINT "agreements_patientAssignorId_fkey"
      FOREIGN KEY ("patientAssignorId") REFERENCES "assignors"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (apply by hand; Prisma has no down-migrations)
--
--   ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_patientAssignorId_fkey";
--   ALTER TABLE "agreements" DROP COLUMN IF EXISTS "patientAssignorId";
--   ALTER TABLE "assignors"  DROP CONSTRAINT IF EXISTS assignors_preferred_channel_reachable;
--   ALTER TABLE "assignors"  DROP CONSTRAINT IF EXISTS assignors_preferred_channel_known;
--   ALTER TABLE "assignors"  DROP CONSTRAINT IF EXISTS assignors_other_basis_has_note;
--   ALTER TABLE "assignors"  DROP CONSTRAINT IF EXISTS assignors_authority_basis_known;
--   ALTER TABLE "assignors"  DROP COLUMN IF EXISTS "preferredChannel";
--   ALTER TABLE "assignors"  DROP COLUMN IF EXISTS "declaredOfFullAgeAt";
--   ALTER TABLE "assignors"  DROP COLUMN IF EXISTS "authorityDeclaredAt";
--
-- Nothing above carries evidence that only lives here — the vault holds the
-- agreement.assignor_changed events — so the rollback loses a preference and a
-- declaration timestamp, and no part of the non-repudiation chain.
-- ---------------------------------------------------------------------------
