import { availableFestivalMonths } from "../festival-dates.ts";
import type { ArtistProfile } from "../domain/artist.ts";
import type { FestivalEdition } from "../domain/edition.ts";
import type { Festival } from "../domain/festival.ts";
import { publicSeasonEditions, seasonYears } from "./seasons.ts";

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
  const publicEditions = publicSeasonEditions(editions);
  return {
    countries: [...new Set(festivals.map((festival) => festival.countryCode))],
    months: availableFestivalMonths(festivals),
    years: seasonYears(publicEditions),
    hasArchive: hasArchiveRecords(publicEditions),
    artists: artists.map(({ name, slug }) => ({ name, slug })),
  };
}

export type CatalogueBrowse = ReturnType<typeof catalogueBrowse>;
