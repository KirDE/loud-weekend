import type { FestivalEdition } from "../domain/edition";

export function parseSeasonYear(value: string): number | undefined {
  return /^[1-9][0-9]{3}$/.test(value) ? Number(value) : undefined;
}

export function publicSeasonEditions(editions: readonly FestivalEdition[]) {
  return editions.filter((edition) => {
    if (edition.recordState === "current") return true;
    if (edition.recordState === "archived") return Boolean(edition.snapshotAt);
    return edition.provenance.some(({ field }) => field === "edition");
  });
}

export function seasonYears(editions: readonly FestivalEdition[]) {
  return [...new Set(editions.map(({ editionYear }) => editionYear))].sort((a, b) => b - a);
}
