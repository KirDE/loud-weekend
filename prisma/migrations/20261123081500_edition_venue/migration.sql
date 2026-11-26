CREATE TABLE "EditionVenue" (
    "editionId" TEXT NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "organizerHost" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "checkedOn" DATE NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "EditionVenue_pkey" PRIMARY KEY ("editionId"),
    CONSTRAINT "EditionVenue_editionId_fkey" FOREIGN KEY ("editionId")
        REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditionVenue_coordinate_check"
        CHECK ("latitude" BETWEEN -85.051129 AND 85.051129 AND "longitude" BETWEEN -180 AND 180)
);
