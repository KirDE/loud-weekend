CREATE TABLE "ReviewedStockProduct" (
    "sourceUrl" TEXT NOT NULL,
    "editionYear" INTEGER NOT NULL,
    "assertions" JSONB NOT NULL,
    CONSTRAINT "ReviewedStockProduct_pkey" PRIMARY KEY ("sourceUrl", "editionYear")
);

INSERT INTO "ReviewedStockProduct" ("sourceUrl", "editionYear", "assertions") VALUES (
    'https://tolminator.mojekarte.si/si/tolminator-2027-festivalska-vstopnica-predprodaja-1-210-eur/vstopnice-1235366.html',
    2027,
    '{
      "title": "TOLMINATOR 2027 FESTIVALSKA VSTOPNICA - PREDPRODAJA 1 - 210 EUR",
      "start": "2027-07-28T00:00:00+02:00",
      "end": "2027-07-31T00:00:00+02:00",
      "price": "210",
      "pageTitle": "Vstopnice za TOLMINATOR 2027 FESTIVALSKA VSTOPNICA - PREDPRODAJA 1 - 210 EUR, 28.07.2027 ob 00:00 (si)",
      "visiblePrice": "210,00 EUR Cena"
    }'::jsonb
);
