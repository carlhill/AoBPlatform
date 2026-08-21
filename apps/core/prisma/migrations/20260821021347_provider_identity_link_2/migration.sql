-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "keycloakUserId" TEXT,
ADD COLUMN     "passkeyEnrolledAt" TIMESTAMP(3);
