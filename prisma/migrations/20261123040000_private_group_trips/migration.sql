-- CreateEnum
CREATE TYPE "GroupTripRole" AS ENUM ('VIEWER', 'VOTER');

-- CreateEnum
CREATE TYPE "GroupTripChoice" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING');

-- CreateEnum
CREATE TYPE "GroupTripAuditAction" AS ENUM ('CREATED', 'INVITED', 'JOINED', 'REVOKED');

-- CreateTable
CREATE TABLE "GroupTrip" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupTripOption" (
    "tripId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,

    CONSTRAINT "GroupTripOption_pkey" PRIMARY KEY ("tripId","editionId")
);

-- CreateTable
CREATE TABLE "GroupTripInvite" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "GroupTripRole" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GroupTripInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupTripVote" (
    "tripId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "choice" "GroupTripChoice" NOT NULL,

    CONSTRAINT "GroupTripVote_pkey" PRIMARY KEY ("tripId","editionId","voterId")
);

-- CreateTable
CREATE TABLE "GroupTripAudit" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "action" "GroupTripAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTripAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupTrip_ownerId_idx" ON "GroupTrip"("ownerId");

-- CreateIndex
CREATE INDEX "GroupTripOption_editionId_idx" ON "GroupTripOption"("editionId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTripInvite_tokenHash_key" ON "GroupTripInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "GroupTripInvite_tripId_claimedById_idx" ON "GroupTripInvite"("tripId", "claimedById");

-- CreateIndex
CREATE INDEX "GroupTripInvite_claimedById_idx" ON "GroupTripInvite"("claimedById");

-- CreateIndex
CREATE INDEX "GroupTripVote_voterId_idx" ON "GroupTripVote"("voterId");

-- CreateIndex
CREATE INDEX "GroupTripAudit_tripId_createdAt_idx" ON "GroupTripAudit"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "GroupTrip" ADD CONSTRAINT "GroupTrip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripOption" ADD CONSTRAINT "GroupTripOption_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "GroupTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripOption" ADD CONSTRAINT "GroupTripOption_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripInvite" ADD CONSTRAINT "GroupTripInvite_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "GroupTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripInvite" ADD CONSTRAINT "GroupTripInvite_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripVote" ADD CONSTRAINT "GroupTripVote_tripId_editionId_fkey" FOREIGN KEY ("tripId", "editionId") REFERENCES "GroupTripOption"("tripId", "editionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripVote" ADD CONSTRAINT "GroupTripVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripAudit" ADD CONSTRAINT "GroupTripAudit_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "GroupTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
