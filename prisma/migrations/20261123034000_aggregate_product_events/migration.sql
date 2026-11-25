CREATE TYPE "ProductEvent" AS ENUM (
  'SEARCH_SUBMIT', 'FILTER_USED', 'COMPARE', 'SAVE', 'TICKET_OUTBOUND',
  'PLAYLIST_START', 'PLAYLIST_SUCCESS', 'NOTIFICATIONS_OPT_IN'
);

CREATE TABLE "ProductEventDaily" (
  "day" DATE NOT NULL,
  "event" "ProductEvent" NOT NULL,
  "locale" VARCHAR(2) NOT NULL CHECK ("locale" IN ('en', 'de', 'ru')),
  "count" INTEGER NOT NULL DEFAULT 0 CHECK ("count" >= 0),
  PRIMARY KEY ("day", "event", "locale")
);
