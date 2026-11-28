import { readDiscoveryPreferences } from "./discovery-preferences.ts";
import { maxTripBudgets, readTripBudgets, type TripBudgets } from "./trip-budget";
import { readPlaylistExclusions } from "./playlist-selection.ts";

export const legacyPlannerYear = 2027;
export type Attendance = "going" | "maybe" | "not-going";

export const seasonAttendanceKey = /^(?!2027:)[1-9][0-9]{3}:[a-z0-9][a-z0-9-]{0,179}$/;
export function isAttendance(value: unknown): value is Attendance {
  return value === "going" || value === "maybe" || value === "not-going";
}

export function readSeasonAttendance(value: unknown): Record<string, Attendance> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Attendance] =>
        seasonAttendanceKey.test(entry[0]) && isAttendance(entry[1]),
    ),
  );
}

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

export function readEditionAttendance(
  state: Pick<PlannerState, "attendance" | "seasonAttendance">,
  slug: string,
  year?: number,
): Attendance | undefined {
  if (year === legacyPlannerYear) return state.attendance[slug];
  return year === undefined ? undefined : state.seasonAttendance?.[`${year}:${slug}`];
}

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
  const seasonAttendance =
    expected && remote.seasonAttendance
      ? applyLocalChanges(
          remote.seasonAttendance,
          current.seasonAttendance ?? {},
          expected.seasonAttendance ?? {},
        )
      : remote.seasonAttendance
        ? { ...remote.seasonAttendance, ...current.seasonAttendance }
        : current.seasonAttendance;
  const tripBudgets =
    expected && remote.tripBudgets
      ? applyLocalChanges(remote.tripBudgets, current.tripBudgets ?? {}, expected.tripBudgets ?? {})
      : { ...remote.tripBudgets, ...current.tripBudgets };
  const playlistExcludedArtists =
    expected && remote.playlistExcludedArtists
      ? (readPlaylistExclusions(
          mergeSelection(
            current.playlistExcludedArtists ?? [],
            remote.playlistExcludedArtists,
            expected.playlistExcludedArtists ?? [],
          ),
        ) ?? current.playlistExcludedArtists)
      : (remote.playlistExcludedArtists ?? current.playlistExcludedArtists);
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
    seasonAttendance,
    tripBudgets:
      Object.keys(tripBudgets).length <= maxTripBudgets ? tripBudgets : (current.tripBudgets ?? {}),
    playlistExcludedArtists,
    savedFilters: readDiscoveryPreferences(filters),
  };
}

export function serializePlannerState(state: PlannerState) {
  const { tripBudgets, ...original } = state;
  return JSON.stringify(tripBudgets && Object.keys(tripBudgets).length ? state : original);
}

export function parsePlannerState(value: string): Partial<PlannerState> {
  const parsed = JSON.parse(value) as Partial<PlannerState>;
  const seasonAttendance = readSeasonAttendance(parsed.seasonAttendance);
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
