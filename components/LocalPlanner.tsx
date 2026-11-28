"use client";

import { sendProductEvent } from "@/lib/product-events";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import {
  legacyPlannerYear,
  mergePlannerState,
  parsePlannerState,
  readEditionAttendance,
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
const plannerStorageKey = "festival-radar-planner-v1";
const Context = createContext<
  | (PlannerState & {
      ready: boolean;
      toggleFestival: (v: string) => void;
      toggleArtist: (slug: string, legacySlugs: Readonly<Record<string, string>>) => void;
      removeArtistKey: (key: string) => void;
      setTripBudget: (key: string, value?: TripBudget) => boolean;
      editionAttendance: (slug: string, year?: number) => Attendance | undefined;
      setEditionAttendance: (
        slug: string,
        year: number | undefined,
        attendance?: Attendance,
      ) => void;
      setPlaylistExclusions: (value: string[]) => void;
      togglePlaylistArtist: (slug: string) => void;
      togglePlaylistFestival: (v: string) => void;
      setSavedFilters: (value: DiscoveryPreferences) => void;
      updateSavedFilters: (patch: Partial<DiscoveryPreferences>) => void;
      replaceFields: (value: Partial<PlannerState>, expected: PlannerState) => void;
      merge: (value: Partial<PlannerState>, expected?: PlannerState) => void;
      clear: (clearRelatedData: () => void) => void;
    })
  | null
>(null);
export function LocalPlannerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(emptyPlannerState);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const value = localStorage.getItem(plannerStorageKey);
      if (value) {
        const restored = parsePlannerState(value);
        setState({
          ...emptyPlannerState,
          ...restored,
          savedFilters: readDiscoveryPreferences(restored.savedFilters),
        });
      }
    } catch {
      localStorage.removeItem(plannerStorageKey);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const serialized = serializePlannerState(state);
    if (localStorage.getItem(plannerStorageKey) !== serialized)
      localStorage.setItem(plannerStorageKey, serialized);
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
      editionAttendance: (slug: string, year?: number) => readEditionAttendance(state, slug, year),
      setEditionAttendance: (slug: string, year: number | undefined, attendance?: Attendance) =>
        setState((current) => {
          if (year === undefined) return current;
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
      merge: (next: Partial<PlannerState>, expected?: PlannerState) =>
        setState((current) => mergePlannerState(current, next, expected)),
      clear: (clearRelatedData: () => void) => {
        const cleared: PlannerState = { ...emptyPlannerState, playlistExcludedArtists: [] };
        const previous = localStorage.getItem(plannerStorageKey);
        localStorage.setItem(plannerStorageKey, serializePlannerState(cleared));
        try {
          clearRelatedData();
        } catch (error) {
          if (previous === null) localStorage.removeItem(plannerStorageKey);
          else localStorage.setItem(plannerStorageKey, previous);
          throw error;
        }
        setState(cleared);
      },
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
