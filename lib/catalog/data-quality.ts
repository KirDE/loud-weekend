import type { CatalogSnapshot } from "./repository";
import { latestDate } from "./freshness";
import { festivalDateInterval } from "../festival-dates";
import { hasAnnouncedLineup } from "../festival-lineup";
import { timetableEntrySchema } from "../timetables";

export function summarizeDataQuality(
  catalog: Pick<CatalogSnapshot, "festivals" | "editions">,
  now = Date.now(),
) {
  const current = catalog.editions.filter(({ recordState }) => recordState === "current");
  const verifiedTime = (value?: string) => (value && Date.parse(value) <= now ? value : undefined);
  const summary = {
    total: catalog.festivals.length,
    dates: 0,
    lineup: 0,
    tickets: 0,
    timetable: 0,
    dateEvidence: 0,
    lineupEvidence: 0,
    checked: 0,
    stale: 0,
    notChecked: 0,
    lastRecentCheck: undefined as string | undefined,
  };
  for (const festival of catalog.festivals) {
    const dateInterval = festivalDateInterval(festival);
    if (dateInterval) summary.dates += 1;
    if (hasAnnouncedLineup(festival)) summary.lineup += 1;
    if (festival.ticketStatus !== "unknown") summary.tickets += 1;
    // A verified range may span New Year. Without both dates, fall back to the edition year.
    const scheduleYear = dateInterval && festival.endDate ? undefined : festival.editionYear;
    const hasUsableSchedule = festival.timetable?.some(
      (entry) =>
        entry.status === "scheduled" &&
        verifiedTime(entry.observedAt) &&
        (!festival.startDate || entry.date >= festival.startDate) &&
        (!festival.endDate || entry.date <= festival.endDate) &&
        timetableEntrySchema.safeParse(entry).success &&
        (scheduleYear === undefined || Number(entry.date.slice(0, 4)) === scheduleYear),
    );
    if (hasUsableSchedule) summary.timetable += 1;
    const freshness = festival.freshness;
    const checkAt = verifiedTime(freshness?.lastSuccessfulSourceCheckAt);
    if (freshness?.sourceCheckStale || festival.sourceDeprecated) {
      summary.stale += 1;
    } else if (checkAt) {
      summary.checked += 1;
      summary.lastRecentCheck = latestDate([summary.lastRecentCheck, checkAt]);
    } else {
      summary.notChecked += 1;
    }
  }
  for (const edition of current) {
    const proof = new Set(
      edition.provenance
        .filter(({ checkedAt }) => verifiedTime(checkedAt))
        .map(({ field }) => field),
    );
    if (proof.has("dates")) summary.dateEvidence += 1;
    if (proof.has("lineup")) summary.lineupEvidence += 1;
  }
  return summary;
}
