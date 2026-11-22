-- Additive review-only evidence storage. No catalogue backfill/publication.
CREATE TABLE "EditionLifecycleProposalSnapshot" (
  "id" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "finalUrl" TEXT NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "proposal" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditionLifecycleProposalSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditionLifecycleProposalSnapshot_editionId_observedAt_key"
  ON "EditionLifecycleProposalSnapshot"("editionId", "observedAt");
ALTER TABLE "EditionLifecycleProposalSnapshot" ADD CONSTRAINT "EditionLifecycleProposalSnapshot_editionId_fkey"
  FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
