ALTER TABLE "TimetablePerformance" ADD COLUMN "sourcePerformanceId" TEXT;

CREATE UNIQUE INDEX "TimetablePerformance_editionId_sourcePerformanceId_key"
ON "TimetablePerformance"("editionId", "sourcePerformanceId");
