CREATE TABLE "FestivalPlaylistLink" (
    "editionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "FestivalPlaylistLink_pkey" PRIMARY KEY ("editionId", "provider"),
    CONSTRAINT "FestivalPlaylistLink_provider_check" CHECK ("provider" IN ('spotify', 'youtube_music')),
    CONSTRAINT "FestivalPlaylistLink_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
