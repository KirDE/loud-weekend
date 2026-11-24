import { z } from "zod";
import type { Festival, TimetableEntry } from "./domain/festival.ts";

export function timetableLocalDateTime(instant: string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instant));
  const {
    year,
    month,
    day,
    hour,
    minute,
    timeZoneName: offset,
  } = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}`, offset };
}

export function isRepeatedTimetableTime(
  instant: string,
  timeZone: string,
  local: ReturnType<typeof timetableLocalDateTime>,
) {
  const timestamp = Date.parse(instant);
  const wallTime = Date.parse(`${local.date}T${local.time}:00Z`);
  const day = 24 * 60 * 60_000;
  // Try the offsets on either side of this instant, including non-hour changes.
  return [-day, day].some((distance) => {
    const sampledAt = timestamp + distance;
    const sample = timetableLocalDateTime(sampledAt, timeZone);
    if (sample.offset === local.offset) return false;
    const sampledWallTime = Date.parse(`${sample.date}T${sample.time}:00Z`);
    const candidate = timetableLocalDateTime(wallTime - (sampledWallTime - sampledAt), timeZone);
    return (
      candidate.date === local.date &&
      candidate.time === local.time &&
      candidate.offset !== local.offset
    );
  });
}

const timetableInstant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Number.isFinite(Date.parse(value)) && Date.parse(value) % 60_000 === 0,
    "performance times must use whole minutes",
  );

export const timetableEntrySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
      }, "date must be a real calendar date"),
    stage: z.string().trim().min(1).max(100),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    artist: z.string().trim().min(1).max(200),
    sourcePerformanceId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
      .optional(),
    timeZone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "timeZone must be a valid IANA identifier"),
    status: z.enum(["scheduled", "cancelled"]),
    sourceUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"), "sourceUrl must use HTTPS"),
    observedAt: z.string().datetime({ offset: true }),
    window: z.object({ startsAt: timetableInstant, endsAt: timetableInstant }).strict().optional(),
  })
  .refine(
    (entry) => {
      if (!entry.window) return true;
      if (entry.status !== "scheduled") return false;
      const { startsAt, endsAt } = entry.window;
      const duration = Date.parse(endsAt) - Date.parse(startsAt);
      if (duration <= 0 || duration > 24 * 60 * 60_000) return false;
      try {
        const local = timetableLocalDateTime(startsAt, entry.timeZone);
        return local.date === entry.date && local.time === entry.start;
      } catch {
        return false;
      }
    },
    {
      path: ["window"],
      message: "a scheduled window must match the local start and end within 24 hours",
    },
  );

export const timetableDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  festivals: z.record(z.string(), z.array(timetableEntrySchema)),
});

export type TimetableDocument = z.infer<typeof timetableDocumentSchema>;
export type TimetableConflict = { date: string; stage: string; start: string; artists: string[] };
export type TimetableStage = { stage: string; entries: TimetableEntry[] };
export type TimetableDay = { date: string; stages: TimetableStage[] };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function findTimetableConflicts(entries: readonly TimetableEntry[]): TimetableConflict[] {
  const slots = new Map<string, Map<number | undefined, Set<string>>>();
  for (const entry of entries.filter(({ status }) => status === "scheduled")) {
    const key = `${entry.date}\u0000${entry.stage.toLocaleLowerCase()}\u0000${entry.start}`;
    const instants = slots.get(key) ?? new Map<number | undefined, Set<string>>();
    const instant = entry.window ? Date.parse(entry.window.startsAt) : undefined;
    const artists = instants.get(instant) ?? new Set<string>();
    artists.add(entry.artist);
    instants.set(instant, artists);
    slots.set(key, instants);
  }

  const conflicts: TimetableConflict[] = [];
  for (const [key, instants] of slots) {
    const [date, stage, start] = key.split("\u0000");
    // A start-only row cannot establish which occurrence of a repeated hour it uses.
    const groups = instants.has(undefined)
      ? [new Set([...instants.values()].flatMap((artists) => [...artists]))]
      : instants.values();
    for (const artists of groups) {
      if (artists.size > 1) {
        conflicts.push({ date, stage, start, artists: [...artists].sort(collator.compare) });
      }
    }
  }
  return conflicts;
}

export function groupTimetable(entries: TimetableEntry[]): TimetableDay[] {
  const days = new Map<string, Map<string, TimetableEntry[]>>();
  for (const entry of entries) {
    const stages = days.get(entry.date) ?? new Map<string, TimetableEntry[]>();
    const stageEntries = stages.get(entry.stage) ?? [];
    stageEntries.push(entry);
    stages.set(entry.stage, stageEntries);
    days.set(entry.date, stages);
  }
  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, stages]) => ({
      date,
      stages: [...stages.entries()]
        .sort(([left], [right]) => collator.compare(left, right))
        .map(([stage, stageEntries]) => ({
          stage,
          entries: stageEntries.sort(
            (left, right) =>
              left.start.localeCompare(right.start) || collator.compare(left.artist, right.artist),
          ),
        })),
    }));
}

export function validateFestivalTimetable(festival: Festival, entries: TimetableEntry[]) {
  const parsed = entries.map((entry) => timetableEntrySchema.parse(entry));
  const errors: string[] = [];
  const identities = new Set<string>();
  const publishedIds = new Set<string>();
  for (const entry of parsed) {
    if (festival.startDate && entry.date < festival.startDate)
      errors.push(`${entry.artist}: ${entry.date} precedes festival start`);
    if (festival.endDate && entry.date > festival.endDate)
      errors.push(`${entry.artist}: ${entry.date} follows festival end`);
    const source = new URL(entry.sourceUrl);
    const official = new URL(festival.officialUrl);
    if (source.hostname !== official.hostname) {
      errors.push(`${entry.artist}: source is not under the festival official URL`);
    }
    const identity = [
      entry.date,
      entry.stage.toLocaleLowerCase(),
      entry.start,
      entry.artist.toLocaleLowerCase(),
      entry.status,
    ].join("\u0000");
    if (identities.has(identity)) errors.push(`${entry.artist}: duplicate timetable row`);
    identities.add(identity);
    if (entry.sourcePerformanceId) {
      if (publishedIds.has(entry.sourcePerformanceId))
        errors.push(`${entry.artist}: duplicate organizer performance ID`);
      publishedIds.add(entry.sourcePerformanceId);
    }
  }
  for (const conflict of findTimetableConflicts(parsed))
    errors.push(
      `conflict at ${conflict.date} ${conflict.start} ${conflict.stage}: ${conflict.artists.join(", ")}`,
    );
  if (errors.length) throw new Error(errors.join("\n"));
  return parsed;
}
