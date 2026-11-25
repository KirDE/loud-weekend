import type { DiscoveryLineups } from "./discovery-sort.ts";

export const maxPlaylistArtistPreferences = 5000;
const artistSlug = /^[a-z0-9][a-z0-9-]{0,199}$/;

export function readPlaylistExclusions(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > maxPlaylistArtistPreferences ||
    value.some((slug) => typeof slug !== "string" || !artistSlug.test(slug))
  )
    return undefined;
  return [...new Set(value)];
}

export function playlistLineup(
  festivalSlugs: string[],
  lineups: DiscoveryLineups,
  artists: { slug: string; name: string }[],
) {
  const candidates = new Set(
    festivalSlugs.flatMap((slug) => lineups.artistSlugsByFestival[slug] ?? []),
  );
  return artists.filter((artist) => candidates.has(artist.slug));
}
