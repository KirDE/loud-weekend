import { festivalDateInterval, formatFestivalDateRange } from "./festival-dates.ts";
import { announcedArtists } from "./festival-lineup.ts";
import type { Festival } from "@/lib/domain/festival";

import { editionOnHiatus } from "./edition-lifecycle.ts";
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
  if (editionOnHiatus(item)) return null;
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

const festivalDescriptionCopy = {
  en: { announced: "Announced acts", fallback: "Festival information on Loud Weekend." },
  de: { announced: "Angekündigte Acts", fallback: "Festivalinfos auf Loud Weekend." },
  ru: { announced: "Объявленные артисты", fallback: "Информация о фестивале на Loud Weekend." },
};

/** Use only the public edition projection, never facts retained for a paused edition. */
export function festivalDescription(item: Festival, language: "en" | "de" | "ru" = "en") {
  if (editionOnHiatus(item)) {
    const descriptions = {
      en: `${item.name} ${item.editionYear}: edition on hiatus. Official announcement and source.`,
      de: `${item.name} ${item.editionYear}: Festivalausgabe pausiert. Offizielle Mitteilung und Quelle.`,
      ru: `${item.name} ${item.editionYear}: фестиваль на паузе. Официальное объявление и источник.`,
    };
    return descriptions[language];
  }
  const title = item.editionYear ? `${item.name} ${item.editionYear}` : item.name;
  const location = [item.city?.trim(), item.country?.trim()].filter(Boolean).join(", ");
  const dates = formatFestivalDateRange(item, language, "");
  const artists = [
    ...new Set(
      announcedArtists(item)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const copy = festivalDescriptionCopy[language];
  const facts = [
    location,
    dates,
    artists.length ? `${copy.announced}: ${new Intl.ListFormat(language).format(artists)}` : "",
  ].filter(Boolean);

  return facts.length ? `${title} · ${facts.join(" · ")}.` : `${title} · ${copy.fallback}`;
}
