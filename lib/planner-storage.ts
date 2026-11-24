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
  savedFilters?: unknown;
};

export function serializePlannerState(state: PlannerState) {
  return JSON.stringify(state);
}

export function parsePlannerState(value: string): Partial<PlannerState> {
  const parsed = JSON.parse(value) as Partial<PlannerState>;
  const seasonAttendance = readSeasonAttendance(parsed.seasonAttendance);
  return {
    ...parsed,
    seasonAttendance: Object.keys(seasonAttendance).length ? seasonAttendance : undefined,
    playlistFestivals: Array.isArray(parsed.playlistFestivals)
      ? parsed.playlistFestivals.filter((item): item is string => typeof item === "string")
      : [],
  };
}
