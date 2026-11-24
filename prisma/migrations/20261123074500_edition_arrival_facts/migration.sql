CREATE TYPE "EditionArrivalKind" AS ENUM ('venue', 'shuttle', 'railShuttle', 'camper');

CREATE TABLE "EditionArrivalFact" (
    "editionId" TEXT NOT NULL,
    "kind" "EditionArrivalKind" NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "organizerHost" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionDe" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "supportingSourceUrl" TEXT,
    "checkedOn" DATE NOT NULL,
    CONSTRAINT "EditionArrivalFact_pkey" PRIMARY KEY ("editionId", "kind"),
    CONSTRAINT "EditionArrivalFact_editionId_fkey" FOREIGN KEY ("editionId")
      REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
