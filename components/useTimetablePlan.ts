"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { parsePerformanceSelections, togglePerformanceSelection } from "@/lib/timetable-plan";

const empty = "[]";
const change = "festival-radar-timetable-plan-change";

function read(key: string | null) {
  try {
    return key ? (localStorage.getItem(key) ?? empty) : empty;
  } catch {
    return empty;
  }
}

export function useTimetablePlan(slug?: string, year?: number) {
  const key = slug && year ? `festival-radar-timetable-v1:${slug}:${year}` : null;
  const [storageFailed, setStorageFailed] = useState(false);
  const subscribe = useCallback(
    (notify: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) notify();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(change, notify);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(change, notify);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => read(key), [key]);
  const selected = parsePerformanceSelections(
    useSyncExternalStore(subscribe, snapshot, () => empty),
  );

  function update(action: (ids: string[]) => string[]) {
    if (!key) return false;
    try {
      const next = action(parsePerformanceSelections(read(key)));
      if (next.length) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
      setStorageFailed(false);
      window.dispatchEvent(new Event(change));
      return true;
    } catch {
      setStorageFailed(true);
      return false;
    }
  }

  return {
    selected,
    storageFailed,
    toggle: (id: string) => update((ids) => togglePerformanceSelection(ids, id)),
    clear: () => update(() => []),
    replace: (ids: string[]) => update(() => ids),
  };
}
