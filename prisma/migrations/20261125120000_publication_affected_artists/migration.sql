-- Historical receipts do not identify the artists actually changed.
ALTER TABLE "CatalogPublication" ADD COLUMN "affectedArtistIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "CatalogPublication_affectedArtistIds_idx" ON "CatalogPublication" USING GIN ("affectedArtistIds");
