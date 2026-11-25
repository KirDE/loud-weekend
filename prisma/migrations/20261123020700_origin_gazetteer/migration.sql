CREATE TABLE "GeographicOrigin" (
  "id" TEXT PRIMARY KEY,
  "countryCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "searchName" TEXT NOT NULL,
  "region" TEXT,
  "postalCode" TEXT,
  "postalKey" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "GeographicOrigin_coordinate_bounds" CHECK
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
CREATE INDEX "GeographicOrigin_searchName_prefix_idx" ON "GeographicOrigin"("searchName" text_pattern_ops);
CREATE INDEX "GeographicOrigin_postalKey_idx" ON "GeographicOrigin"("postalKey");
