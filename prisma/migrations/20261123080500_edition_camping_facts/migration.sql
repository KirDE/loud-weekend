CREATE TYPE "EditionCampingField" AS ENUM ('camping', 'arrival', 'accessibility', 'facilities', 'motorhomes', 'viewing');

CREATE TABLE "EditionCampingFact" (
    "editionId" TEXT NOT NULL,
    "field" "EditionCampingField" NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "organizerHost" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionDe" TEXT,
    "descriptionRu" TEXT,
    "earliestDate" DATE,
    "sourceUrl" TEXT NOT NULL,
    "checkedOn" DATE NOT NULL,
    CONSTRAINT "EditionCampingFact_pkey" PRIMARY KEY ("editionId", "field"),
    CONSTRAINT "EditionCampingFact_editionId_fkey" FOREIGN KEY ("editionId")
        REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditionCampingFact_shape_check" CHECK (
        ("field" = 'arrival' AND "earliestDate" IS NOT NULL
            AND "descriptionEn" IS NULL AND "descriptionDe" IS NULL AND "descriptionRu" IS NULL)
        OR
        ("field" <> 'arrival' AND "earliestDate" IS NULL
            AND "descriptionEn" IS NOT NULL AND "descriptionDe" IS NOT NULL AND "descriptionRu" IS NOT NULL)
    )
);
