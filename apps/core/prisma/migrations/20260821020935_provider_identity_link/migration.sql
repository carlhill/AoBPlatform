-- AlterTable
ALTER TABLE "staff_members" ADD COLUMN     "email" TEXT,
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "keycloakUserId" TEXT,
ADD COLUMN     "passkeyEnrolledAt" TIMESTAMP(3);
