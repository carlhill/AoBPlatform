-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "channelsEnabled" TEXT[] DEFAULT ARRAY['in_practice', 'sms_link', 'email_link', 'paper']::TEXT[],
ADD COLUMN     "identifierTypes" TEXT[] DEFAULT ARRAY['name', 'date_of_birth', 'address']::TEXT[],
ADD COLUMN     "linkExpiryHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "rails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "senderIdRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writeBackProven" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "practice_locations" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "practice_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_locations_practiceId_idx" ON "practice_locations"("practiceId");

-- CreateIndex
CREATE INDEX "staff_members_practiceId_idx" ON "staff_members"("practiceId");

-- AddForeignKey
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "practice_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_locations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_members" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "practice_locations"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "staff_members"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
