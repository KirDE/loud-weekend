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

export function hasSeasonCalendarDates(edition: FestivalEdition) {
  const { startDate, endDate } = edition;
  const fields = new Set(edition.provenance.map(({ field }) => field));
  return (
    (fields.has("dates") || (fields.has("startDate") && fields.has("endDate"))) &&
    Boolean(
      startDate && endDate && validDate(startDate) && validDate(endDate) && startDate <= endDate,
    )
  );
}

function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
