import type { Festival } from "./domain/festival.ts";
import type { DiscoveryLineups } from "./discovery-sort.ts";

export type DiscoveryArtist = { slug: string; name: string };
export type ArtistMatchMode = "all" | "any";
export const maxSelectedArtists = 12;

export function readArtistSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((slug): slug is string =>
    typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)))].slice(0, maxSelectedArtists);
}

export function festivalArtistMatch(festival: Festival, selected: readonly string[], lineups?: DiscoveryLineups) {
  const roster = new Set(lineups?.artistSlugsByFestival[festival.slug]);
  return { known: roster.size > 0, matched: [...new Set(selected)].filter(slug => roster.has(slug)) };
}

export function matchesArtistMode(match: ReturnType<typeof festivalArtistMatch>, selectedCount: number, mode: ArtistMatchMode) {
  if (!selectedCount) return true;
  return match.known && (mode === "any" ? match.matched.length > 0 : match.matched.length === selectedCount);
}
