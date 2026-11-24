"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { parsePlannerState, serializePlannerState } from "@/lib/planner-storage";
import {
  defaultDiscoveryPreferences,
  readDiscoveryPreferences,
  type DiscoveryPreferences,
} from "@/lib/discovery-preferences";
export type Attendance = "going" | "maybe" | "not-going";
export type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, Attendance>;
  playlistFestivals: string[];
  savedFilters: DiscoveryPreferences;
};
export const emptyPlannerState: PlannerState = {
  favoriteFestivals: [],
  favoriteArtists: [],
  attendance: {},
  playlistFestivals: [],
  savedFilters: defaultDiscoveryPreferences,
};
const Context = createContext<
  | (PlannerState & {
      ready: boolean;
      toggleFestival: (v: string) => void;
      toggleArtist: (v: string) => void;
      setAttendance: (v: string, a?: Attendance) => void;
      togglePlaylistFestival: (v: string) => void;
      setSavedFilters: (value: DiscoveryPreferences) => void;
      updateSavedFilters: (patch: Partial<DiscoveryPreferences>) => void;
      replace: (value: PlannerState) => void;
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
      toggleArtist: (v: string) =>
        setState((s) => ({
          ...s,
          favoriteArtists: toggle(s.favoriteArtists, v),
        })),
      setAttendance: (v: string, a?: Attendance) =>
        setState((s) => {
          const attendance = { ...s.attendance };
          if (a) attendance[v] = a;
          else delete attendance[v];
          return { ...s, attendance };
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
        setState({
          ...emptyPlannerState,
          ...next,
          savedFilters: readDiscoveryPreferences(next.savedFilters),
        }),
      replaceFields: (fields: Partial<PlannerState>, expected: PlannerState) =>
        setState((current) => {
          // The selected account document may have been loading while the device was edited.
          const keys = Object.keys(fields) as (keyof PlannerState)[];
          if (keys.some((key) => !Object.is(current[key], expected[key]))) return current;
          return { ...current, ...fields };
        }),
      merge: (next: Partial<PlannerState>) =>
        setState((current) => ({
          favoriteFestivals: Array.from(
            new Set([...current.favoriteFestivals, ...(next.favoriteFestivals || [])]),
          ),
          favoriteArtists: Array.from(
            new Set([...current.favoriteArtists, ...(next.favoriteArtists || [])]),
          ),
          attendance: { ...next.attendance, ...current.attendance },
          playlistFestivals: Array.from(
            new Set([...current.playlistFestivals, ...(next.playlistFestivals || [])]),
          ),
          savedFilters: readDiscoveryPreferences({ ...current.savedFilters, ...next.savedFilters }),
        })),
      clear: () => setState(emptyPlannerState),
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
export function FavoriteButton({ kind, value }: { kind: "festival" | "artist"; value: string }) {
  const p = useLocalPlanner();
  const { t } = useLanguage();
  const selected = (kind === "festival" ? p.favoriteFestivals : p.favoriteArtists).includes(value);
  return (
    <button
      className={`favoriteButton${selected ? " selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => (kind === "festival" ? p.toggleFestival(value) : p.toggleArtist(value))}
    >
      {t(selected ? "saved" : "save")}
    </button>
  );
}
