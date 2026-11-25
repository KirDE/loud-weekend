import { readTripBudgets, type TripBudgets } from "./trip-budget";
import { readPlaylistExclusions } from "./playlist-selection.ts";

export const legacyPlannerYear = 2027;
export type Attendance = "going" | "maybe" | "not-going";

type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, Attendance>;
  seasonAttendance?: Record<string, Attendance>;
  playlistFestivals: string[];
  tripBudgets?: TripBudgets;
  playlistExcludedArtists?: string[];
  savedFilters?: unknown;
};

export function serializePlannerState(state: PlannerState) {
  const { tripBudgets, ...original } = state;
  return JSON.stringify(tripBudgets && Object.keys(tripBudgets).length ? state : original);
}

export function parsePlannerState(value: string): Partial<PlannerState> {
  const parsed = JSON.parse(value) as Partial<PlannerState>;
  const seasonAttendance = Object.fromEntries(
    Object.entries(parsed.seasonAttendance ?? {}).filter(
      ([key, attendance]) =>
        /^[1-9][0-9]{3}:[a-z0-9][a-z0-9-]*$/.test(key) &&
        !key.startsWith(`${legacyPlannerYear}:`) &&
        (attendance === "going" || attendance === "maybe" || attendance === "not-going"),
    ),
  );
  return {
    ...parsed,
    seasonAttendance: Object.keys(seasonAttendance).length ? seasonAttendance : undefined,
    tripBudgets: readTripBudgets(parsed.tripBudgets),
    playlistFestivals: Array.isArray(parsed.playlistFestivals)
      ? parsed.playlistFestivals.filter((item): item is string => typeof item === "string")
      : [],
    playlistExcludedArtists: readPlaylistExclusions(parsed.playlistExcludedArtists),
  };
}
