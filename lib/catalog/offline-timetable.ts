import { timetableEntrySchema } from "../timetables.ts";

export const offlineTimetableWhere = {
  timeZone: { not: null },
  sourceUrl: { not: null },
  observedAt: { not: null },
} as const;

export const offlineTimetableSelect = {
  date: true, stage: true, start: true, artistName: true, timeZone: true, status: true,
  sourceUrl: true, observedAt: true,
} as const;

type TimetableRow = {
  date: Date; stage: string; start: string; artistName: string; timeZone: string | null;
  status: string; sourceUrl: string | null; observedAt: Date | null;
};

export function projectOfflinePerformance(row: TimetableRow) {
  const entry = timetableEntrySchema.safeParse({
    date: row.date.toISOString().slice(0, 10), stage: row.stage, start: row.start,
    artist: row.artistName, timeZone: row.timeZone,
    status: row.status === "CANCELLED" ? "cancelled" : "scheduled",
    sourceUrl: row.sourceUrl, observedAt: row.observedAt?.toISOString(),
  });
  if (!entry.success) return [];
  // The source URL validates the stored proof but is not part of either download.
  const { date, stage, start, artist, timeZone, status, observedAt } = entry.data;
  return [{ date, stage, start, artist, timeZone, status, checkedAt: observedAt }];
}
