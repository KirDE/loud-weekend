import type { Festival } from "@/lib/domain/festival";

import { editionOnHiatus } from "./edition-lifecycle.ts";

export const SITE_ORIGIN = "https://loudweekend.eu";
export const CATALOG_UPDATED_AT = "2026-09-01T15:18:00.000Z";

export function canonicalPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function festivalMusicEvent(item: Festival) {
  // A paused edition is not a scheduled event, sale or confirmed replacement.
  if (editionOnHiatus(item)) return null;
  const hasVerifiedDates = Boolean(item.startDate);
  const availability = item.ticketStatus === "available"
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
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
    ...(hasVerifiedDates && item.status !== "tba"
      ? { eventStatus: "https://schema.org/EventScheduled" }
      : {}),
    location: {
      "@type": "Place",
      name: item.city || item.country,
      address: { "@type": "PostalAddress", addressCountry: item.countryCode },
    },
    url: `${SITE_ORIGIN}/festivals/${item.slug}/`,
    sameAs: item.officialUrl,
    ...(item.ticketsUrl && availability
      ? { offers: { "@type": "Offer", url: item.ticketsUrl, availability } }
      : {}),
  };
}

/** Descriptive metadata must not promote old scheduled facts for a paused edition. */
export function festivalDescription(item: Festival, language: "en" | "de" | "ru" = "en") {
  if (editionOnHiatus(item)) {
    const descriptions = {
      en: `${item.name} ${item.editionYear}: edition on hiatus. Official announcement and source.`,
      de: `${item.name} ${item.editionYear}: Festivalausgabe pausiert. Offizielle Mitteilung und Quelle.`,
      ru: `${item.name} ${item.editionYear}: фестиваль на паузе. Официальное объявление и источник.`,
    };
    return descriptions[language];
  }
  return `${item.name} ${item.editionYear ?? 2027}: dates, lineup, tickets, playlist and setlists.`;
}
