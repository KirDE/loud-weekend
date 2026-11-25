CREATE TABLE "EditionLineupDayAllocation" (
    "editionId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "dates" DATE[] NOT NULL,
    "status" "LineupEntryStatus" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EditionLineupDayAllocation_pkey" PRIMARY KEY ("editionId", "artistId"),
    CONSTRAINT "EditionLineupDayAllocation_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditionLineupDayAllocation_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EditionLineupDayAllocation_artistId_idx" ON "EditionLineupDayAllocation"("artistId");
