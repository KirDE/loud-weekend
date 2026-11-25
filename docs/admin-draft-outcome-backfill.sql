-- Optional, separately authorized operational backfill. Not a schema migration.
-- Run after the PARTIALLY_APPLIED enum value is available.
-- Derive historical mixed outcomes from the recorded field decisions.
UPDATE "AdminDraft" AS draft
SET "status" = 'PARTIALLY_APPLIED'
FROM (
  SELECT "draftId"
  FROM "AdminChange"
  WHERE "draftId" IS NOT NULL
  GROUP BY "draftId"
  HAVING bool_or("status" = 'APPROVED')
    AND bool_or("status" = 'REJECTED')
    AND bool_and("status" IN ('APPROVED', 'REJECTED'))
) AS mixed
WHERE draft."id" = mixed."draftId"
  AND draft."status" IN ('APPLIED', 'REJECTED');
