"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { parsePerformanceSelections, togglePerformanceSelection } from "@/lib/timetable-plan";

import { timetablePlanChanged, timetablePlanKey } from "@/lib/timetable-plan-storage";

const empty = "[]";

function read(key: string | null) {
  try {
    return key ? (localStorage.getItem(key) ?? empty) : empty;
  } catch {
    return empty;
  }
}

export function useTimetablePlan(slug?: string, year?: number) {
  const key = slug && year ? timetablePlanKey(slug, year) : null;
  const [storageFailed, setStorageFailed] = useState(false);
  const subscribe = useCallback(
    (notify: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) notify();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(timetablePlanChanged, notify);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(timetablePlanChanged, notify);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => read(key), [key]);
  const selected = parsePerformanceSelections(
    useSyncExternalStore(subscribe, snapshot, () => empty),
  );

  function update(action: (ids: string[]) => string[], expected?: string[]) {
    if (!key) return "failed";
    try {
      const current = parsePerformanceSelections(localStorage.getItem(key) ?? empty);
      if (
        expected &&
        (current.length !== expected.length || current.some((id, i) => id !== expected[i]))
      ) {
        return "deviceChanged";
      }
      const next = action(current);
      if (next.length) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
      setStorageFailed(false);
      window.dispatchEvent(new Event(timetablePlanChanged));
      return "updated";
    } catch {
      setStorageFailed(true);
      return "failed";
    }
  }

  return {
    selected,
    storageFailed,
    toggle: (id: string) => update((ids) => togglePerformanceSelection(ids, id)) === "updated",
    clear: () => update(() => []) === "updated",
    replace: (ids: string[], expected: string[]) => update(() => ids, expected),
  };
}
