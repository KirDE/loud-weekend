CREATE TABLE "TicketOfferReviewDecision" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('approve', 'reject')),
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketOfferReviewDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketOfferReviewDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TicketOfferProposalSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketOfferReviewDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TicketOfferReviewDecision_snapshotId_key" ON "TicketOfferReviewDecision"("snapshotId");
