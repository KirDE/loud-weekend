import type { Festival } from "./domain/festival";
import { isCalendarDate } from "./domain/edition-dates.ts";

type Dates = Pick<Festival, "startDate" | "endDate">;

export function festivalDateInterval(item: Dates): { start: Date; end: Date } | null {
  const start = item.startDate;
  const end = item.endDate ?? start;
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) return null;
  return { start: new Date(start + "T00:00:00Z"), end: new Date(end + "T00:00:00Z") };
}

export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** Month is 1–12; omit year only for the season-wide discovery filter. */
export function festivalOverlapsMonth(item: Dates, month: number, year?: number): boolean {
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

export function formatFestivalDateRange(item: Dates, locale: string, unknown: string): string {
  const interval = festivalDateInterval(item);
  if (!interval) return unknown;
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const start = formatter.format(interval.start);
  return interval.start.valueOf() === interval.end.valueOf() ? start : `${start} – ${formatter.format(interval.end)}`;
}
