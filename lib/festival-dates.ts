import type { Festival } from "./domain/festival";

import { editionOnHiatus } from "./edition-lifecycle.ts";

type Dates = Pick<Festival, "startDate" | "endDate"> & Partial<Pick<Festival, "slug" | "editionYear" | "officialUrl" | "editionLifecycle">>;

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function festivalDateInterval(item: Dates): { start: Date; end: Date } | null {
  const start = parseDate(item.startDate);
  const end = parseDate(item.endDate ?? item.startDate);
  return start && end && start <= end ? { start, end } : null;
}

export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** Month is 1–12; omit year only for the season-wide discovery filter. */
export function festivalOverlapsMonth(item: Dates, month: number, year?: number): boolean {
  if (editionOnHiatus(item)) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const interval = festivalDateInterval(item);
  if (!interval) return false;
  const first = monthIndex(interval.start), last = monthIndex(interval.end);
  if (year !== undefined) {
    const target = year * 12 + month - 1;
    return target >= first && target <= last;
  }
  const offset = (month - 1 - interval.start.getUTCMonth() + 12) % 12;
  return first + offset <= last;
}

export function availableFestivalMonths(items: Dates[]): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .filter(month => items.some(item => festivalOverlapsMonth(item, month)));
}

export function formatFestivalDateRange(item: Dates, locale: string, unknown: string, hiatus = "Edition on hiatus"): string {
  if (editionOnHiatus(item)) return hiatus;
  const interval = festivalDateInterval(item);
  if (!interval) return unknown;
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const start = formatter.format(interval.start);
  return interval.start.valueOf() === interval.end.valueOf() ? start : `${start} – ${formatter.format(interval.end)}`;
}
