import type { TimetableEntry } from "./domain/festival.ts";

const maxSelections = 150;

export function parsePerformanceSelections(raw: string) {
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.filter(
          (value): value is string =>
            typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),
        ),
      ),
    ].slice(0, maxSelections);
  } catch {
    return [];
  }
}

export function togglePerformanceSelection(ids: string[], id: string) {
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return ids.length < maxSelections ? [...ids, id] : ids;
}

export function assessPerformanceSelections(entries: TimetableEntry[]) {
  const scheduled = entries.filter((entry) => entry.status === "scheduled");
  const verified = scheduled
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

  const conflicts: [TimetableEntry, TimetableEntry][] = [];
  for (const [index, left] of verified.entries()) {
    for (let i = index + 1; i < verified.length && verified[i].from < left.until; i++) {
      conflicts.push([left.entry, verified[i].entry]);
    }
  }
  return { conflicts, incomplete: verified.length < scheduled.length };
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
