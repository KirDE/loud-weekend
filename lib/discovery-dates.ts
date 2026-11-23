import { festivalDateInterval, parseFestivalDate } from "./festival-dates.ts";
import type { Festival } from "./domain/festival.ts";

export type DiscoveryDates = {
  dateFrom: string;
  dateTo: string;
  weekendOnly: boolean;
  maxDays: string;
};

export const defaultDiscoveryDates: DiscoveryDates = {
  dateFrom: "", dateTo: "", weekendOnly: false, maxDays: "all",
};

const dayMs = 86_400_000;

export function readDiscoveryDates(fields: Record<string, unknown>): DiscoveryDates {
  const readDate = (value: unknown) => typeof value === "string" && parseFestivalDate(value) ? value : "";
  return {
    dateFrom: readDate(fields.dateFrom),
    dateTo: readDate(fields.dateTo),
    weekendOnly: fields.weekendOnly === true,
    maxDays: typeof fields.maxDays === "string" && /^(?:[1-9]|[1-9]\d)$/.test(fields.maxDays) ? fields.maxDays : "all",
  };
}

export function hasDiscoveryDates(filters: DiscoveryDates) {
  return Boolean(filters.dateFrom || filters.dateTo || filters.weekendOnly || filters.maxDays !== "all");
}

export function reversedDiscoveryDates({ dateFrom, dateTo }: DiscoveryDates) {
  return Boolean(dateFrom && dateTo && dateFrom > dateTo);
}

export function matchesDiscoveryDates(festival: Pick<Festival, "startDate" | "endDate">, filters: DiscoveryDates) {
  if (!hasDiscoveryDates(filters)) return true;
  if (reversedDiscoveryDates(filters)) return false;
  const interval = festivalDateInterval(festival);
  if (!interval) return false;

  const from = parseFestivalDate(filters.dateFrom);
  const to = parseFestivalDate(filters.dateTo);
  const start = from && from > interval.start ? from : interval.start;
  const end = to && to < interval.end ? to : interval.end;
  if (start > end) return false;

  const totalDays = (interval.end.valueOf() - interval.start.valueOf()) / dayMs + 1;
  if (filters.maxDays !== "all" && totalDays > Number(filters.maxDays)) return false;

  const daysUntilSaturday = (6 - start.getUTCDay() + 7) % 7;
  return !filters.weekendOnly || start.getUTCDay() === 0 || start.valueOf() + daysUntilSaturday * dayMs <= end.valueOf();
}

const dateQueryKeys = ["dateFrom", "dateTo", "weekend", "maxDays"] as const;

export function datesFromQuery(query: Pick<URLSearchParams, "get">): DiscoveryDates | null {
  const filters = readDiscoveryDates({
    dateFrom: query.get("dateFrom"),
    dateTo: query.get("dateTo"),
    weekendOnly: query.get("weekend") === "1",
    maxDays: query.get("maxDays"),
  });
  return hasDiscoveryDates(filters) && !reversedDiscoveryDates(filters) ? filters : null;
}

export function removeDateQuery(url: URL) {
  for (const key of dateQueryKeys) url.searchParams.delete(key);
}

export function dateShareQuery(filters: DiscoveryDates) {
  const query = new URLSearchParams();
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  if (filters.weekendOnly) query.set("weekend", "1");
  if (filters.maxDays !== "all") query.set("maxDays", filters.maxDays);
  return query.toString();
}
