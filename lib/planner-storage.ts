import { readDiscoveryPreferences } from "./discovery-preferences.ts";

type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, "going" | "maybe" | "not-going">;
  playlistFestivals: string[];
  savedFilters?: unknown;
};

function mergeSelection(current: string[], remote?: string[], expected?: string[]) {
  if (!remote) return current;
  if (!expected) return [...new Set([...current, ...remote])];
  const before = new Set(expected);
  const after = new Set(current);
  return [
    ...new Set([
      ...remote.filter((key) => !before.has(key) || after.has(key)),
      ...current.filter((key) => !before.has(key)),
    ]),
  ];
}

function applyLocalChanges<T>(
  remote: Record<string, T>,
  current: Record<string, T>,
  expected: Record<string, T>,
) {
  const result = new Map(Object.entries(remote));
  for (const key of new Set([...Object.keys(expected), ...Object.keys(current)])) {
    if (current[key] === expected[key]) continue;
    if (Object.hasOwn(current, key)) result.set(key, current[key]);
    else result.delete(key);
  }
  return Object.fromEntries(result);
}

export function mergePlannerState(
  current: PlannerState,
  remote: Partial<PlannerState>,
  expected?: PlannerState,
) {
  // After an account merge, the response already includes the request snapshot.
  // Replay only the edits made while that request was in flight.
  const attendance =
    expected && remote.attendance
      ? applyLocalChanges(remote.attendance, current.attendance, expected.attendance)
      : { ...remote.attendance, ...current.attendance };
  const currentFilters = readDiscoveryPreferences(current.savedFilters);
  const filters =
    expected && remote.savedFilters !== undefined
      ? applyLocalChanges(
          readDiscoveryPreferences(remote.savedFilters),
          currentFilters,
          readDiscoveryPreferences(expected.savedFilters),
        )
      : { ...currentFilters, ...(remote.savedFilters as object) };
  return {
    favoriteFestivals: mergeSelection(
      current.favoriteFestivals,
      remote.favoriteFestivals,
      expected?.favoriteFestivals,
    ),
    favoriteArtists: mergeSelection(
      current.favoriteArtists,
      remote.favoriteArtists,
      expected?.favoriteArtists,
    ),
    playlistFestivals: mergeSelection(
      current.playlistFestivals,
      remote.playlistFestivals,
      expected?.playlistFestivals,
    ),
    attendance,
    savedFilters: readDiscoveryPreferences(filters),
  };
}

export function serializePlannerState(state: PlannerState) {
  return JSON.stringify(state);
}

export function parsePlannerState(value: string): Partial<PlannerState> {
  const parsed = JSON.parse(value) as Partial<PlannerState>;
  return {
    ...parsed,
    playlistFestivals: Array.isArray(parsed.playlistFestivals)
      ? parsed.playlistFestivals.filter((item): item is string => typeof item === "string")
      : [],
  };
}
