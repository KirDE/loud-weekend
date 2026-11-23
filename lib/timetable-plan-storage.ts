import { maxPerformanceSelections, parsePerformanceSelections } from "./timetable-plan";

const prefix = "festival-radar-timetable-v1:";
export const timetablePlanChanged = "festival-radar-timetable-plan-change";

export function timetablePlanKey(slug: string, year: number) {
  return `${prefix}${slug}:${year}`;
}

function ownedPlanKey(key: string) {
  return key.startsWith(prefix) && /^[a-z0-9-]+:\d{4}$/.test(key.slice(prefix.length));
}

export function browserRunningOrderSnapshot(storage: Storage) {
  const plans: Record<string, string[]> = Object.create(null);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !ownedPlanKey(key)) continue;
    plans[key] = parsePerformanceSelections(storage.getItem(key) ?? "[]");
  }
  return plans;
}

export function clearBrowserRunningOrders(storage: Storage, snapshot: Record<string, string[]>) {
  const cleared = new Map<string, string>();
  try {
    for (const key of Object.keys(snapshot)) {
      if (!ownedPlanKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      storage.removeItem(key);
      cleared.set(key, raw);
    }
  } catch (error) {
    for (const [key, raw] of cleared) storage.setItem(key, raw);
    throw error;
  }
}

export function restoreBrowserRunningOrders(storage: Storage, snapshot: Record<string, string[]>) {
  for (const [key, previous] of Object.entries(snapshot)) {
    if (!previous.length || !ownedPlanKey(key)) continue;
    const current = parsePerformanceSelections(storage.getItem(key) ?? "[]");
    const restored = [...new Set([...current, ...previous])].slice(0, maxPerformanceSelections);
    storage.setItem(key, JSON.stringify(restored));
  }
}
