import type { Festival } from "./domain/festival.ts";
import type { DiscoveryLineups } from "./discovery-sort.ts";

export function compareFestivalLineups(festivals: readonly Festival[], lineups?: DiscoveryLineups) {
  const select = (items: readonly Festival[]) => {
    const rosters = items.map((item) => lineups?.artistSlugsByFestival[item.slug] ?? []);
    if (rosters.some((roster) => roster.length === 0)) return null;
    const [first, ...others] = rosters.map((roster) => new Set(roster));
    return first ? [...first].filter((slug) => others.every((roster) => roster.has(slug))) : [];
  };
  const pairs = festivals.flatMap((first, index) =>
    festivals.slice(index + 1).map((second) => ({
      festivals: [first, second] as const,
      shared: select([first, second]),
    })),
  );
  return { pairs, sharedAcrossAll: festivals.length >= 3 ? select(festivals) : null };
}
