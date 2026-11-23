import { defaultDiscoveryDates, readDiscoveryDates, type DiscoveryDates } from "./discovery-dates.ts";
import type { Coordinates } from "./festival-discovery.ts";

export const discoveryOrigins = {
  berlin: { label: "Berlin, Germany", coordinates: { latitude: 52.5200, longitude: 13.4050 } },
  cologne: { label: "Cologne, Germany", coordinates: { latitude: 50.9375, longitude: 6.9603 } },
  amsterdam: { label: "Amsterdam, Netherlands", coordinates: { latitude: 52.3676, longitude: 4.9041 } },
  london: { label: "London, United Kingdom", coordinates: { latitude: 51.5072, longitude: -0.1276 } },
  prague: { label: "Prague, Czechia", coordinates: { latitude: 50.0755, longitude: 14.4378 } },
} satisfies Record<string, { label: string; coordinates: Coordinates }>;

export const discoveryDistances = ["100", "250", "500", "1000", "2000"] as const;

export type DiscoveryPreferences = DiscoveryDates & {
  query: string;
  country: string;
  announcedOnly: boolean;
  month: string;
  ticketsOnly: boolean;
  genre: string;
  origin: keyof typeof discoveryOrigins;
  maxDistance: string;
};

export const defaultDiscoveryPreferences: DiscoveryPreferences = {
  ...defaultDiscoveryDates,
  query: "",
  country: "all",
  announcedOnly: false,
  month: "all",
  ticketsOnly: false,
  genre: "all",
  origin: "berlin",
  maxDistance: "all",
};

export function readDiscoveryPreferences(value: unknown): DiscoveryPreferences {
  const fields = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    ...readDiscoveryDates(fields),
    query: typeof fields.query === "string" ? fields.query : defaultDiscoveryPreferences.query,
    country: typeof fields.country === "string" && /^[A-Z]{2}$/.test(fields.country) ? fields.country : defaultDiscoveryPreferences.country,
    announcedOnly: fields.announcedOnly === true,
    month: typeof fields.month === "string" && /^(0[1-9]|1[0-2])$/.test(fields.month) ? fields.month : defaultDiscoveryPreferences.month,
    ticketsOnly: fields.ticketsOnly === true,
    genre: typeof fields.genre === "string" && fields.genre.trim() ? fields.genre : defaultDiscoveryPreferences.genre,
    origin: typeof fields.origin === "string" && Object.hasOwn(discoveryOrigins, fields.origin)
      ? fields.origin as DiscoveryPreferences["origin"] : defaultDiscoveryPreferences.origin,
    maxDistance: discoveryDistances.find(distance => distance === fields.maxDistance) ?? defaultDiscoveryPreferences.maxDistance,
  };
}
