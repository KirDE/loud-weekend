import { readArtistSelection } from "./discovery-artists.ts";
import { datesFromQuery, dateShareQuery, removeDateQuery } from "./discovery-dates.ts";
import {
  defaultDiscoveryPreferences,
  readDiscoveryPreferences,
  type DiscoveryPreferences,
} from "./discovery-preferences.ts";
import type { DiscoveryLineups } from "./discovery-sort.ts";

const textFields = ["country", "month", "genre", "origin", "sort"] as const;
const flags = ["announcedOnly", "ticketsOnly"] as const;
const shareMarker = "filters";
const favoriteLimit = 100;

function boundedText(value: string | null, max: number): string {
  return value && value.length <= max && !/[\p{Cc}]/u.test(value) ? value : "";
}

export function shareableFavoriteSlugs(favorites: readonly string[], lineups?: DiscoveryLineups) {
  const current = new Set(Object.values(lineups?.artistSlugsByFestival ?? {}).flat());
  const slugs = favorites.map((key) =>
    key.startsWith("artist:")
      ? key.slice(7)
      : lineups && Object.hasOwn(lineups.legacyFavoriteSlugs, key)
        ? lineups.legacyFavoriteSlugs[key]
        : "",
  );
  return [...new Set(slugs.filter((slug) => current.has(slug)))].sort();
}

export function discoveryShareQuery(
  filters: DiscoveryPreferences,
  favorites: readonly string[] = [],
) {
  const query = new URLSearchParams([[shareMarker, "1"]]);
  for (const field of textFields) {
    if (
      filters.customOrigin &&
      (field === "origin" || (field === "sort" && filters.sort === "distance"))
    )
      continue;
    if (filters[field] !== defaultDiscoveryPreferences[field]) query.set(field, filters[field]);
  }
  for (const field of flags) if (filters[field]) query.set(field, "1");
  if (!filters.customOrigin && filters.maxDistance !== "all")
    query.set("radius", filters.maxDistance);
  if (boundedText(filters.query, 120)) query.set("q", filters.query);
  for (const [key, value] of new URLSearchParams(dateShareQuery(filters))) query.set(key, value);
  for (const slug of readArtistSelection(filters.artistSelection).sort())
    query.append("matchArtist", slug);
  if (filters.artistSelection?.length && filters.artistMatch === "any")
    query.set("artistMatch", "any");
  if (filters.sort === "favorites" && favorites.length <= favoriteLimit) {
    for (const slug of [...new Set(favorites)].sort()) query.append("artist", slug);
  }
  return query.toString();
}

export function discoveryFromQuery(
  query: Pick<URLSearchParams, "get" | "getAll">,
  lineups?: DiscoveryLineups,
) {
  if (query.get(shareMarker) !== "1") return null;
  const fields = Object.fromEntries(
    textFields.map((field) => [field, boundedText(query.get(field), 80)]),
  );
  const filters = readDiscoveryPreferences({
    ...fields,
    ...Object.fromEntries(flags.map((field) => [field, query.get(field) === "1"])),
    ...datesFromQuery(query),
    maxDistance: query.get("radius"),
    query: boundedText(query.get("q"), 120),
  });
  const artists = query.getAll("artist");
  const favorites =
    filters.sort === "favorites" && artists.length <= favoriteLimit
      ? shareableFavoriteSlugs(
          artists.map((slug) => `artist:${slug}`),
          lineups,
        ).map((slug) => `artist:${slug}`)
      : [];
  const selection = readArtistSelection(query.getAll("matchArtist"));
  if (selection.length) {
    filters.artistSelection = shareableFavoriteSlugs(
      selection.map((slug) => `artist:${slug}`),
      lineups,
    );
    if (query.get("artistMatch") === "any") filters.artistMatch = "any";
  }
  return { filters, favorites };
}

export function removeDiscoveryQuery(url: URL) {
  const fields = [shareMarker, ...textFields, ...flags, "radius", "q", "artist"];
  for (const field of fields) url.searchParams.delete(field);
  removeDateQuery(url);
}
