CREATE TABLE "RunningOrder" (
    "userId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "performanceIds" TEXT[] NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RunningOrder_pkey" PRIMARY KEY ("userId", "editionId"),
    CONSTRAINT "RunningOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunningOrder_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RunningOrder_editionId_idx" ON "RunningOrder"("editionId");
