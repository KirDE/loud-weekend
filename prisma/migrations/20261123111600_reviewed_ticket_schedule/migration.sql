CREATE TABLE "ReviewedTicketSchedule" (
    "sourceUrl" TEXT NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "dates" JSONB NOT NULL,
    CONSTRAINT "ReviewedTicketSchedule_pkey" PRIMARY KEY ("sourceUrl", "editionYear")
);

INSERT INTO "ReviewedTicketSchedule" ("sourceUrl", "editionYear", "dates") VALUES (
    'https://rockforpeople.cz/',
    2027,
    '{
      "festivalStart": "2027-06-02",
      "festivalEnd": "2027-06-05",
      "saleStart": "2026-06-18T10:00:00+02:00",
      "scheduleStart": "2027-06-02T12:00:01+02:00",
      "scheduleEnd": "2027-06-05T23:59:00+02:00",
      "rateStart": "2026-08-05T20:49:00+02:00"
    }'::jsonb
);
