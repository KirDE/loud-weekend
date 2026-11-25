-- CreateTable
CREATE TABLE "GroupTripComment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTripComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupTripComment_tripId_editionId_createdAt_idx" ON "GroupTripComment"("tripId", "editionId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupTripComment_authorId_idx" ON "GroupTripComment"("authorId");

-- AddForeignKey
ALTER TABLE "GroupTripComment" ADD CONSTRAINT "GroupTripComment_tripId_editionId_fkey" FOREIGN KEY ("tripId", "editionId") REFERENCES "GroupTripOption"("tripId", "editionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTripComment" ADD CONSTRAINT "GroupTripComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
