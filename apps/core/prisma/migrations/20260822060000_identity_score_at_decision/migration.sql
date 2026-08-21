-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "identityEnforcementAtDecision" TEXT,
ADD COLUMN     "identityOverrideReason" TEXT,
ADD COLUMN     "identityScoreAtDecision" INTEGER,
ADD COLUMN     "identityScoringVersion" TEXT,
ADD COLUMN     "identityWouldPassAtDecision" BOOLEAN;
