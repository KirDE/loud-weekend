import { availableFestivalMonths } from "../festival-dates.ts";
import type { ArtistProfile } from "../domain/artist.ts";
import type { FestivalEdition } from "../domain/edition.ts";
import type { Festival } from "../domain/festival.ts";

export function hasArchiveRecords(editions: readonly FestivalEdition[]) {
  return editions.some(
    (edition) => edition.recordState === "archived" || edition.recordState === "tracking",
  );
}

export function catalogueBrowse(
  festivals: readonly Festival[],
  editions: readonly FestivalEdition[],
  artists: readonly ArtistProfile[],
) {
  return {
    countries: [...new Set(festivals.map((festival) => festival.countryCode))],
    months: availableFestivalMonths(festivals),
    years: [...new Set(editions.map((edition) => edition.editionYear))].sort((a, b) => b - a),
    hasArchive: hasArchiveRecords(editions),
    artists: artists.map(({ name, slug }) => ({ name, slug })),
  };
}

export type CatalogueBrowse = ReturnType<typeof catalogueBrowse>;
