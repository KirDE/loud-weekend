import { festivalDateInterval } from "./festival-dates.ts";
import { announcedArtists } from "./festival-lineup.ts";
import type { Festival } from "@/lib/domain/festival";

import { supportedLanguages } from "./catalog/public";

export const SITE_ORIGIN = "https://loudweekend.eu";

export function canonicalPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function localizedAlternates(path: string): Record<string, string> {
  const canonical = canonicalPath(path);
  return Object.fromEntries([
    ["x-default", canonical],
    ...supportedLanguages.map((lang) => [lang, `/${lang}${canonical}`]),
  ]);
}

export function festivalMusicEvent(item: Festival, language?: string) {
  const interval = festivalDateInterval(item);
  const performers = [...new Set(announcedArtists(item))]
    .filter((name) => name.trim())
    .map((name) => ({ "@type": "MusicGroup", name }));
  const availability =
    item.ticketStatus === "available"
      ? "https://schema.org/InStock"
      : item.ticketStatus === "low"
        ? "https://schema.org/LimitedAvailability"
        : item.ticketStatus === "sold_out"
          ? "https://schema.org/SoldOut"
          : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: item.name,
    ...(interval ? { startDate: item.startDate } : {}),
    ...(interval && item.endDate ? { endDate: item.endDate } : {}),
    ...(interval && item.status !== "tba"
      ? { eventStatus: "https://schema.org/EventScheduled" }
      : {}),
    location: {
      "@type": "Place",
      name: item.city || item.country,
      address: {
        "@type": "PostalAddress",
        addressCountry: item.countryCode,
        ...(item.city ? { addressLocality: item.city } : {}),
      },
    },
    ...(performers.length ? { performer: performers } : {}),
    url: `${SITE_ORIGIN}${language ? `/${language}` : ""}/festivals/${item.slug}/`,
    sameAs: item.officialUrl,
    ...(item.ticketStatus === "free" ? { isAccessibleForFree: true } : {}),
    ...(!item.ticketOffers && item.ticketsUrl && availability
      ? { offers: { "@type": "Offer", url: item.ticketsUrl, availability } }
      : {}),
  };
}
