import type { Festival } from "./domain/festival.ts";
import { discoveryFavoriteSlugs, type DiscoveryLineups } from "./discovery-sort.ts";
import { festivalDateInterval } from "./festival-dates.ts";
import { distanceKm, festivalGenres } from "./festival-discovery.ts";

export function festivalArtists(item: Festival) {
  return new Set([...item.headliners, ...item.lineup].map((artist) => artist.toLocaleLowerCase()));
}

export function lineupOverlap(items: Festival[]) {
  if (items.length < 2) return [];
  const [first, ...rest] = items.map(festivalArtists);
  return [...first].filter((artist) => rest.every((set) => set.has(artist))).sort();
}

const dayMs = 86_400_000;
const nearbyDays = 14;
const nearbyKm = 250;

export function similarFestivals(
  item: Festival,
  festivals: Festival[],
  options: {
    lineups?: DiscoveryLineups;
    favorites?: readonly string[];
    locale: string;
  },
  limit = 3,
) {
  const collator = new Intl.Collator(options.locale, { sensitivity: "base" });
  const artistSlugs = options.lineups?.artistSlugsByFestival;
  const artists = new Set(artistSlugs?.[item.slug]);
  const genres = new Set(festivalGenres([item]));
  const favorites = discoveryFavoriteSlugs(options.favorites ?? [], options.lineups);
  const dates = festivalDateInterval(item);
  return festivals
    .filter((candidate) => candidate.slug !== item.slug)
    .map((festival) => {
      const candidateArtists = [...new Set(artistSlugs?.[festival.slug])];
      const shared = candidateArtists.filter((slug) => artists.has(slug)).length;
      const favoriteCount = candidateArtists.filter((slug) => favorites.has(slug)).length;
      const sharedGenres = festivalGenres([festival]).filter((genre) => genres.has(genre));
      const candidateDates = festivalDateInterval(festival);
      const gapDays =
        dates && candidateDates
          ? Math.max(
              0,
              dates.start.valueOf() - candidateDates.end.valueOf(),
              candidateDates.start.valueOf() - dates.end.valueOf(),
            ) / dayMs
          : null;
      const distance =
        item.coordinates && festival.coordinates
          ? distanceKm(item.coordinates, festival.coordinates)
          : null;
      return {
        festival,
        shared,
        favoriteCount,
        sharedGenres,
        gapDays: gapDays !== null && gapDays <= nearbyDays ? gapDays : null,
        distance: distance !== null && distance <= nearbyKm ? distance : null,
      };
    })
    .filter(
      (match) =>
        match.shared ||
        match.favoriteCount ||
        match.sharedGenres.length ||
        (match.gapDays !== null && match.distance !== null),
    )
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        b.favoriteCount - a.favoriteCount ||
        b.sharedGenres.length - a.sharedGenres.length ||
        (a.gapDays ?? Infinity) - (b.gapDays ?? Infinity) ||
        (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
        collator.compare(a.festival.name, b.festival.name) ||
        a.festival.slug.localeCompare(b.festival.slug, "en"),
    )
    .slice(0, limit);
}

function compactDate(value: string) {
  return value.replaceAll("-", "");
}

function escapeIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

export function calendarFile(items: Festival[]) {
  const events = items
    .filter((item) => item.startDate)
    .flatMap((item) => {
      const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const location = [item.city, item.country].filter(Boolean).join(", ");
      return [
        "BEGIN:VEVENT",
        `UID:${item.slug}-${item.editionYear || 2027}@festival-radar`,
        `DTSTART;VALUE=DATE:${compactDate(item.startDate!)}`,
        `DTEND;VALUE=DATE:${compactDate(end.toISOString().slice(0, 10))}`,
        `SUMMARY:${escapeIcs(item.name)}`,
        `LOCATION:${escapeIcs(location)}`,
        `DESCRIPTION:${escapeIcs(`Official information: ${item.officialUrl}`)}`,
        `URL:${item.officialUrl}`,
        "END:VEVENT",
      ];
    });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//Loud Weekend//European Festivals//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function calendarUrls(item: Festival) {
  if (!item.startDate) return null;
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const exclusiveEnd = end.toISOString().slice(0, 10);
  const dates = `${compactDate(item.startDate)}/${compactDate(exclusiveEnd)}`;
  const details = `Official information: ${item.officialUrl}`;
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: item.name,
    dates,
    details,
    location: [item.city, item.country].filter(Boolean).join(", "),
  });
  return {
    google: `https://calendar.google.com/calendar/render?${query}`,
    ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile([item]))}`,
    apple: `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile([item]))}`,
  };
}
