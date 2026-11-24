import { readTripBudgets, type TripBudgets } from "./trip-budget";
import { readPlaylistExclusions } from "./playlist-selection.ts";

type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, "going" | "maybe" | "not-going">;
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
  return {
    ...parsed,
    tripBudgets: readTripBudgets(parsed.tripBudgets),
    playlistFestivals: Array.isArray(parsed.playlistFestivals)
      ? parsed.playlistFestivals.filter((item): item is string => typeof item === "string")
      : [],
    playlistExcludedArtists: readPlaylistExclusions(parsed.playlistExcludedArtists),
  };
}
