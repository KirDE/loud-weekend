-- Review-only staging; no backfill, source registration or catalog publication.
CREATE TABLE "TicketOfferProposalSnapshot" (
  "id" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "proposal" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketOfferProposalSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketOfferProposalSnapshot_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TicketOfferProposalSnapshot_editionId_observedAt_key" ON "TicketOfferProposalSnapshot"("editionId", "observedAt");
