CREATE TYPE "CorrectionKind" AS ENUM ('DATE', 'LINEUP', 'TICKETS', 'IDENTITY');
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

CREATE TABLE "CorrectionReport" (
    "id" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "editionId" TEXT,
    "editionYear" INTEGER,
    "artistId" TEXT,
    "kind" "CorrectionKind" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "notes" TEXT,
    "fingerprint" TEXT NOT NULL,
    "reporterHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,

    CONSTRAINT "CorrectionReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CorrectionReport_target_check" CHECK (
       ("artistId" IS NOT NULL AND "editionId" IS NULL AND "editionYear" IS NULL AND "kind" = 'IDENTITY')
       OR ("artistId" IS NULL AND "editionId" IS NOT NULL AND "editionYear" IS NOT NULL AND "kind" <> 'IDENTITY')
    ),
    CONSTRAINT "CorrectionReport_decision_check" CHECK (
       ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "reviewerId" IS NULL)
       OR ("status" <> 'PENDING' AND "reviewedAt" IS NOT NULL AND "reviewerId" IS NOT NULL)
    )
);
CREATE INDEX "CorrectionReport_status_submittedAt_idx" ON "CorrectionReport"("status", "submittedAt");
CREATE INDEX "CorrectionReport_reporterHash_submittedAt_idx" ON "CorrectionReport"("reporterHash", "submittedAt");
CREATE INDEX "CorrectionReport_fingerprint_submittedAt_idx" ON "CorrectionReport"("fingerprint", "submittedAt");
CREATE INDEX "CorrectionReport_submittedAt_idx" ON "CorrectionReport"("submittedAt");
