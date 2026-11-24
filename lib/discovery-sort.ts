import type { Festival } from "./domain/festival.ts";
import { distanceKm, type Coordinates } from "./festival-discovery.ts";
import { festivalDateInterval } from "./festival-dates.ts";

export const discoverySorts = ["date", "name", "distance", "acts", "favorites"] as const;
export type DiscoverySort = (typeof discoverySorts)[number];
type ArtistKey = { slug: string; name: string; aliases: readonly string[] };

export type DiscoveryLineups = {
  artistSlugsByFestival: Readonly<Record<string, readonly string[]>>;
  legacyFavoriteSlugs: Readonly<Record<string, string>>;
  artistNamesBySlug?: Readonly<Record<string, string>>;
};

export function uniqueFavoriteSlugs(artists: readonly ArtistKey[], current: ReadonlySet<string>) {
  const matches = new Map<string, string | null>();
  for (const artist of artists) {
    for (const name of [artist.name, ...artist.aliases]) {
      if (!matches.has(name)) matches.set(name, artist.slug);
      else if (matches.get(name) !== artist.slug) matches.set(name, null);
    }
  }
  return Object.fromEntries(
    [...matches].filter(
      (entry): entry is [string, string] => entry[1] !== null && current.has(entry[1]),
    ),
  );
}

export function discoveryFavoriteSlugs(favorites: readonly string[], lineups?: DiscoveryLineups) {
  return new Set(
    favorites.flatMap((key) => {
      if (key.startsWith("artist:")) return [key.slice("artist:".length)];
      if (lineups && Object.hasOwn(lineups.legacyFavoriteSlugs, key))
        return [lineups.legacyFavoriteSlugs[key]];
      return [];
    }),
  );
}

export function sortDiscoveryFestivals(
  festivals: Festival[],
  sort: DiscoverySort,
  options: {
    locale: string;
    origin: Coordinates;
    favorites: readonly string[];
    lineups?: DiscoveryLineups;
  },
) {
  const collator = new Intl.Collator(options.locale, { sensitivity: "base" });
  const favoriteSlugs = discoveryFavoriteSlugs(options.favorites, options.lineups);

  return festivals
    .map((festival) => {
      const start = festivalDateInterval(festival)?.start.valueOf() ?? Infinity;
      const artists = options.lineups?.artistSlugsByFestival[festival.slug] ?? [];
      let rank = 0;
      if (sort === "distance")
        rank = festival.coordinates ? distanceKm(options.origin, festival.coordinates) : Infinity;
      if (sort === "acts") rank = artists.length ? -artists.length : Infinity;
      if (sort === "favorites")
        rank = artists.length
          ? -artists.filter((slug) => favoriteSlugs.has(slug)).length
          : Infinity;
      return { festival, start, rank };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (sort !== "name" && a.start !== b.start) return a.start - b.start;
      return (
        collator.compare(a.festival.name, b.festival.name) ||
        a.festival.slug.localeCompare(b.festival.slug, "en")
      );
    })
    .map(({ festival }) => festival);
}
