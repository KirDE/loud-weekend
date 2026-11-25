ALTER TABLE "TimetablePerformance"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD CONSTRAINT "TimetablePerformance_verified_window_check" CHECK (
    ("startsAt" IS NULL AND "endsAt" IS NULL) OR
    ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt" AND "status" = 'ANNOUNCED')
  );
