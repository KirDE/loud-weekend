CREATE TABLE "EditionOverview" (
    "editionId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "organizerHost" TEXT NOT NULL,
    "checkedOn" DATE NOT NULL,
    "sourceUrls" TEXT[] NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryDe" TEXT NOT NULL,
    "summaryRu" TEXT NOT NULL,

    CONSTRAINT "EditionOverview_pkey" PRIMARY KEY ("editionId")
);

ALTER TABLE "EditionOverview" ADD CONSTRAINT "EditionOverview_editionId_fkey"
    FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
