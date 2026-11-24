"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import {
  legacyPlannerYear,
  parsePlannerState,
  serializePlannerState,
  type Attendance,
} from "@/lib/planner-storage";
export type { Attendance };
import { type TripBudget, type TripBudgets, maxTripBudgets } from "@/lib/trip-budget";
import {
  defaultDiscoveryPreferences,
  readDiscoveryPreferences,
  type DiscoveryPreferences,
} from "@/lib/discovery-preferences";
import { readPlaylistExclusions } from "@/lib/playlist-selection";
export type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, Attendance>;
  seasonAttendance?: Record<string, Attendance>;
  tripBudgets: TripBudgets;
  playlistFestivals: string[];
  playlistExcludedArtists?: string[];
  savedFilters: DiscoveryPreferences;
};
export const emptyPlannerState: PlannerState = {
  favoriteFestivals: [],
  favoriteArtists: [],
  attendance: {},
  tripBudgets: {},
  playlistFestivals: [],
  savedFilters: defaultDiscoveryPreferences,
};
const Context = createContext<
  | (PlannerState & {
      ready: boolean;
      toggleFestival: (v: string) => void;
      toggleArtist: (v: string, legacyValues: readonly string[]) => void;
      setTripBudget: (key: string, value?: TripBudget) => boolean;
      setAttendance: (v: string, a?: Attendance) => void;
      editionAttendance: (slug: string, year: number) => Attendance | undefined;
      setEditionAttendance: (slug: string, year: number, attendance?: Attendance) => void;
      setPlaylistExclusions: (value: string[]) => void;
      togglePlaylistArtist: (slug: string) => void;
      togglePlaylistFestival: (v: string) => void;
      setSavedFilters: (value: DiscoveryPreferences) => void;
      updateSavedFilters: (patch: Partial<DiscoveryPreferences>) => void;
      replace: (value: PlannerState) => void;
      replaceFields: (value: Partial<PlannerState>) => void;
      merge: (value: Partial<PlannerState>) => void;
      clear: () => void;
    })
  | null
>(null);
export function LocalPlannerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(emptyPlannerState);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const value = localStorage.getItem("festival-radar-planner-v1");
      if (value) {
        const restored = parsePlannerState(value);
        setState({
          ...emptyPlannerState,
          ...restored,
          savedFilters: readDiscoveryPreferences(restored.savedFilters),
        });
      }
    } catch {
      localStorage.removeItem("festival-radar-planner-v1");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("festival-radar-planner-v1", serializePlannerState(state));
  }, [ready, state]);
  const toggle = (a: string[], v: string) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
  const value = useMemo(
    () => ({
      ...state,
      ready,
      toggleFestival: (v: string) =>
        setState((s) => ({
          ...s,
          favoriteFestivals: toggle(s.favoriteFestivals, v),
        })),
      toggleArtist: (v: string, legacyValues: readonly string[]) =>
        setState((s) => {
          const matches = new Set([v, ...legacyValues]);
          return {
            ...s,
            favoriteArtists: s.favoriteArtists.some((value) => matches.has(value))
              ? s.favoriteArtists.filter((value) => !matches.has(value))
              : [...s.favoriteArtists, v],
          };
        }),
      setAttendance: (v: string, a?: Attendance) =>
        setState((s) => {
          const attendance = { ...s.attendance };
          if (a) attendance[v] = a;
          else delete attendance[v];
          return { ...s, attendance };
        }),
      editionAttendance: (slug: string, year: number) =>
        year === legacyPlannerYear
          ? state.attendance[slug]
          : state.seasonAttendance?.[`${year}:${slug}`],
      setEditionAttendance: (slug: string, year: number, attendance?: Attendance) =>
        setState((current) => {
          // The original planner already stores the 2027 plan; keep one copy.
          const field = year === legacyPlannerYear ? "attendance" : "seasonAttendance";
          const key = year === legacyPlannerYear ? slug : `${year}:${slug}`;
          const selections = { ...current[field] };
          if (attendance) selections[key] = attendance;
          else delete selections[key];
          return { ...current, [field]: selections };
        }),
      setTripBudget: (key: string, estimate?: TripBudget) => {
        if (
          estimate &&
          !state.tripBudgets[key] &&
          Object.keys(state.tripBudgets).length >= maxTripBudgets
        )
          return false;
        setState((current) => {
          const tripBudgets = { ...current.tripBudgets };
          if (estimate) tripBudgets[key] = estimate;
          else delete tripBudgets[key];
          return { ...current, tripBudgets };
        });
        return true;
      },
      setPlaylistExclusions: (value: string[]) => {
        const exclusions = readPlaylistExclusions(value);
        if (exclusions) setState((s) => ({ ...s, playlistExcludedArtists: exclusions }));
      },
      togglePlaylistArtist: (slug: string) =>
        setState((s) => {
          const exclusions = readPlaylistExclusions(toggle(s.playlistExcludedArtists ?? [], slug));
          return exclusions ? { ...s, playlistExcludedArtists: exclusions } : s;
        }),
      togglePlaylistFestival: (v: string) =>
        setState((s) => ({
          ...s,
          playlistFestivals: toggle(s.playlistFestivals, v),
        })),
      setSavedFilters: (savedFilters: DiscoveryPreferences) =>
        setState((s) => ({ ...s, savedFilters })),
      updateSavedFilters: (patch: Partial<DiscoveryPreferences>) =>
        setState((s) => ({ ...s, savedFilters: { ...s.savedFilters, ...patch } })),
      replace: (next: PlannerState) =>
        setState((current) => ({
          ...emptyPlannerState,
          ...next,
          savedFilters: readDiscoveryPreferences(next.savedFilters),
          seasonAttendance: next.seasonAttendance ?? current.seasonAttendance,
        })),
      replaceFields: (fields: Partial<PlannerState>) =>
        setState((current) => ({ ...current, ...fields })),
      merge: (next: Partial<PlannerState>) =>
        setState((current) => {
          const tripBudgets = { ...next.tripBudgets, ...current.tripBudgets };
          return {
            favoriteFestivals: Array.from(
              new Set([...current.favoriteFestivals, ...(next.favoriteFestivals || [])]),
            ),
            favoriteArtists: Array.from(
              new Set([...current.favoriteArtists, ...(next.favoriteArtists || [])]),
            ),
            attendance: { ...next.attendance, ...current.attendance },
            seasonAttendance: next.seasonAttendance
              ? { ...next.seasonAttendance, ...current.seasonAttendance }
              : current.seasonAttendance,
            tripBudgets:
              Object.keys(tripBudgets).length <= maxTripBudgets ? tripBudgets : current.tripBudgets,
            playlistFestivals: Array.from(
              new Set([...current.playlistFestivals, ...(next.playlistFestivals || [])]),
            ),
            playlistExcludedArtists:
              next.playlistExcludedArtists ?? current.playlistExcludedArtists,
            savedFilters: readDiscoveryPreferences({
              ...current.savedFilters,
              ...next.savedFilters,
            }),
          };
        }),
      clear: () => setState({ ...emptyPlannerState, playlistExcludedArtists: [] }),
    }),
    [ready, state],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocalPlanner() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing LocalPlannerProvider");
  return value;
}
export function FavoriteButton({
  kind,
  value,
  legacyValues = [],
}: {
  kind: "festival" | "artist";
  value: string;
  legacyValues?: readonly string[];
}) {
  const p = useLocalPlanner();
  const { t } = useLanguage();
  const selected =
    kind === "festival"
      ? p.favoriteFestivals.includes(value)
      : p.favoriteArtists.some((saved) => saved === value || legacyValues.includes(saved));
  return (
    <button
      className={`favoriteButton${selected ? " selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() =>
        kind === "festival" ? p.toggleFestival(value) : p.toggleArtist(value, legacyValues)
      }
    >
      {t(selected ? "saved" : "save")}
    </button>
  );
}
