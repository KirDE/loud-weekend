import type { Language } from "../lib/language-preference.ts";

export type OfflineTrip = {
  version: 1; slug: string; year: number; name: string;
  startDate: string | null; endDate: string | null; location: string | null; updatedAt: string;
  timetable: { date: string; start: string; stage: string; artist: string; timeZone: string; status: "scheduled" | "cancelled"; checkedAt: string }[];
};
export type OfflineTripRecord = { trip: OfflineTrip; savedAt: string };
type Label = "heading" | "save" | "update" | "remove" | "open" | "saved" | "removed" | "pending" | "unavailable" | "storage"
  | "stale" | "savedAt" | "checkedAt" | "performanceChecked" | "dates" | "place" | "timetable" | "cancelled" | "empty";

export const offlineTripCopy: Record<Language, Record<Label, string>>;
export function fetchOfflineTrip(basePath: string, slug: string, year: number): Promise<OfflineTrip>;
export function offlineTripKey(slug: string, year: number): string;
export function parseOfflineTrip(value: unknown): OfflineTrip | null;
export function readOfflineTrip(storage: Storage, slug: string, year: number): OfflineTripRecord | null;
export function saveOfflineTrip(storage: Storage, trip: unknown, savedAt?: string): OfflineTripRecord;
export function listOfflineTrips(storage: Storage): OfflineTripRecord[];
