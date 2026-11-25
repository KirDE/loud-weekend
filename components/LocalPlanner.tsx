"use client";

import { sendProductEvent } from "@/lib/product-events";
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
import { favoriteArtistSlug, toggleFavoriteArtist } from "@/lib/favorite-artists";
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
      toggleArtist: (slug: string, legacySlugs: Readonly<Record<string, string>>) => void;
      removeArtistKey: (key: string) => void;
      setTripBudget: (key: string, value?: TripBudget) => boolean;
      setAttendance: (v: string, a?: Attendance) => void;
      editionAttendance: (slug: string, year: number) => Attendance | undefined;
      setEditionAttendance: (slug: string, year: number, attendance?: Attendance) => void;
      setPlaylistExclusions: (value: string[]) => void;
      togglePlaylistArtist: (slug: string) => void;
      togglePlaylistFestival: (v: string) => void;
      setSavedFilters: (value: DiscoveryPreferences) => void;
      updateSavedFilters: (patch: Partial<DiscoveryPreferences>) => void;
      replaceFields: (value: Partial<PlannerState>, expected: PlannerState) => void;
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
      toggleArtist: (slug: string, legacySlugs: Readonly<Record<string, string>>) =>
        setState((s) => ({
          ...s,
          favoriteArtists: toggleFavoriteArtist(s.favoriteArtists, slug, legacySlugs),
        })),
      removeArtistKey: (key: string) =>
        setState((s) => ({
          ...s,
          favoriteArtists: s.favoriteArtists.filter((item) => item !== key),
        })),
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
      replaceFields: (fields: Partial<PlannerState>, expected: PlannerState) =>
        setState((current) => {
          // The selected account document may have been loading while the device was edited.
          const keys = Object.keys(fields) as (keyof PlannerState)[];
          if (keys.some((key) => !Object.is(current[key], expected[key]))) return current;
          return { ...current, ...fields };
        }),
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
export function FavoriteButton({ value }: { value: string }) {
  const p = useLocalPlanner();
  const { language, t } = useLanguage();
  const selected = p.favoriteFestivals.includes(value);
  return (
    <button
      className={`favoriteButton${selected ? " selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => {
        if (!selected) sendProductEvent("SAVE", language);
        p.toggleFestival(value);
      }}
    >
      {t(selected ? "saved" : "save")}
    </button>
  );
}

export function ArtistFavoriteButton({
  slug,
  name,
  legacySlugs,
}: {
  slug: string;
  name: string;
  legacySlugs: Readonly<Record<string, string>>;
}) {
  const p = useLocalPlanner();
  const { t } = useLanguage();
  const selected = p.favoriteArtists.some((key) => favoriteArtistSlug(key, legacySlugs) === slug);
  return (
    <button
      className={`favoriteButton${selected ? " selected" : ""}`}
      type="button"
      disabled={!p.ready}
      aria-pressed={selected}
      aria-label={t(selected ? "saved" : "save") + ": " + name}
      onClick={() => p.toggleArtist(slug, legacySlugs)}
    >
      {t(selected ? "saved" : "save")}
    </button>
  );
}
