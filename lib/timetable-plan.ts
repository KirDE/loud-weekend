import { escapeIcs } from "./planning.ts";
import type { TimetableEntry } from "./domain/festival.ts";

export const maxPerformanceSelections = 150;
export const performanceSelectionId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function parsePerformanceSelections(raw: string) {
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.filter(
          (value): value is string =>
            typeof value === "string" && performanceSelectionId.test(value),
        ),
      ),
    ].slice(0, maxPerformanceSelections);
  } catch {
    return [];
  }
}

export function togglePerformanceSelection(ids: string[], id: string) {
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return ids.length < maxPerformanceSelections ? [...ids, id] : ids;
}

function verifiedPerformanceWindows(entries: TimetableEntry[]) {
  const scheduled = entries.filter((entry) => entry.status === "scheduled");
  return scheduled
    .flatMap((entry) =>
      entry.window
        ? [
            {
              entry,
              from: Date.parse(entry.window.startsAt),
              until: Date.parse(entry.window.endsAt),
            },
          ]
        : [],
    )
    .filter((window) => window.until > window.from)
    .sort((left, right) => left.from - right.from);
}

export function assessPerformanceSelections(entries: TimetableEntry[]) {
  const scheduledCount = entries.filter((entry) => entry.status === "scheduled").length;
  const verified = verifiedPerformanceWindows(entries);

  const conflicts: [TimetableEntry, TimetableEntry][] = [];
  for (const [index, left] of verified.entries()) {
    for (let i = index + 1; i < verified.length && verified[i].from < left.until; i++) {
      conflicts.push([left.entry, verified[i].entry]);
    }
  }
  return { conflicts, incomplete: verified.length < scheduledCount };
}

function utcCalendarTime(instant: number) {
  return new Date(instant)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function foldCalendarLine(line: string) {
  const encoder = new TextEncoder();
  let bytes = 0;
  let folded = "";
  for (const char of line) {
    const length = encoder.encode(char).length;
    if (bytes + length > 75) {
      folded += "\r\n ";
      bytes = 1;
    }
    folded += char;
    bytes += length;
  }
  return folded;
}

export function runningOrderCalendar(entries: TimetableEntry[], slug: string, year: number) {
  const events = verifiedPerformanceWindows(entries).flatMap(({ entry, from, until }) => {
    const checked = Date.parse(entry.observedAt);
    if (!entry.sourcePerformanceId || !Number.isFinite(checked)) return [];
    const id = encodeURIComponent(entry.sourcePerformanceId);
    return [
      "BEGIN:VEVENT",
      `UID:performance:${year}:${encodeURIComponent(slug)}:${id}@festival-radar`,
      `DTSTAMP:${utcCalendarTime(checked)}`,
      `DTSTART:${utcCalendarTime(from)}`,
      `DTEND:${utcCalendarTime(until)}`,
      `SUMMARY:${escapeIcs(entry.artist)}`,
      `LOCATION:${escapeIcs(entry.stage)}`,
      "END:VEVENT",
    ];
  });
  return events.length
    ? [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "PRODID:-//Loud Weekend//Running Order//EN",
        ...events,
        "END:VCALENDAR",
        "",
      ]
        .map(foldCalendarLine)
        .join("\r\n")
    : null;
}

export function orderPerformanceSelections(entries: readonly TimetableEntry[]) {
  const localOrder = [...entries].sort(
    (left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start),
  );
  const verified = localOrder
    .flatMap((entry) =>
      entry.window ? [{ entry, instant: Date.parse(entry.window.startsAt) }] : [],
    )
    .sort((left, right) => left.instant - right.instant);

  // Keep start-only slots in local order without guessing which UTC offset they use.
  let index = 0;
  return localOrder.map((entry) => (entry.window ? verified[index++].entry : entry));
}
