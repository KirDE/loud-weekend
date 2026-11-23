CREATE TABLE "ReviewedTicketProof" (
    "festivalSlug" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "proof" JSONB NOT NULL,
    CONSTRAINT "ReviewedTicketProof_pkey" PRIMARY KEY ("festivalSlug", "sourceUrl", "editionYear")
);
