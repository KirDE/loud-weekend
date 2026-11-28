import type { Festival } from "./domain/festival.ts";
import { discoveryFavoriteSlugs, type DiscoveryLineups } from "./discovery-sort.ts";
import { editionOnHiatus } from "./edition-lifecycle.ts";
import { festivalDateInterval } from "./festival-dates.ts";
import { distanceKm, festivalGenres } from "./festival-discovery.ts";
import { announcedArtists } from "./festival-lineup.ts";

export function festivalArtists(item: Festival) {
  return new Set(announcedArtists(item).map((artist) => artist.toLocaleLowerCase()));
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
  if (editionOnHiatus(item) || item.editionYear === undefined) return [];
  const collator = new Intl.Collator(options.locale, { sensitivity: "base" });
  const artistSlugs = options.lineups?.artistSlugsByFestival;
  const artists = new Set(artistSlugs?.[item.slug]);
  const genres = new Set(festivalGenres([item]));
  const favorites = discoveryFavoriteSlugs(options.favorites ?? [], options.lineups);
  const dates = festivalDateInterval(item);
  return festivals
    .filter(
      (candidate) =>
        candidate.slug !== item.slug &&
        candidate.editionYear === item.editionYear &&
        !editionOnHiatus(candidate),
    )
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

function calendarDates(item: CalendarEvent) {
  if (editionOnHiatus(item)) return null;
  const interval = festivalDateInterval(item);
  if (!interval) return null;
  const { start, end } = interval;
  end.setUTCDate(end.getUTCDate() + 1);
  // iCalendar DATE uses a four-digit year.
  if (end.getUTCFullYear() > 9999) return null;
  return {
    start: start.toISOString().slice(0, 10).replaceAll("-", ""),
    end: end.toISOString().slice(0, 10).replaceAll("-", ""),
  };
}

export function escapeIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

/** Scheduled calendar eligibility, not a mutation of canonical date facts. */
export function calendarEligible(item: CalendarEvent): boolean {
  return calendarDates(item) !== null;
}

type CalendarEvent = Pick<
  Festival,
  | "slug"
  | "editionYear"
  | "name"
  | "city"
  | "country"
  | "officialUrl"
  | "startDate"
  | "endDate"
  | "editionLifecycle"
> & { calendarId?: string; calendarUpdatedAt?: string; updatedAt?: string };

function foldCalendarLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const nextBytes = encoder.encode(character).length;
    if (bytes + nextBytes > 75) {
      parts.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += nextBytes;
  }
  return [...parts, part].join("\r\n");
}

function calendarStamp(value: string | undefined, generatedAt: Date) {
  const date = value ? new Date(value) : generatedAt;
  const iso = Number.isNaN(date.getTime()) ? generatedAt.toISOString() : date.toISOString();
  return iso.replace(/[-:]|\.\d{3}/g, "");
}

export function calendarFile(items: readonly CalendarEvent[], generatedAt = new Date()) {
  const events = items.flatMap((item) => {
    const dates = calendarDates(item);
    if (!dates) return [];
    const modifiedAt = item.calendarUpdatedAt;
    const location = [item.city, item.country].filter(Boolean).join(", ");
    const year = item.editionYear;
    const edition =
      year && Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : "unknown-edition";
    return [
      "BEGIN:VEVENT",
      `UID:${item.calendarId ?? `${item.slug}-${edition}`}@festival-radar`,
      `DTSTAMP:${calendarStamp(item.calendarUpdatedAt ?? item.updatedAt, generatedAt)}`,
      ...(modifiedAt && Number.isFinite(Date.parse(modifiedAt))
        ? [`LAST-MODIFIED:${calendarStamp(modifiedAt, generatedAt)}`]
        : []),
      `DTSTART;VALUE=DATE:${dates.start}`,
      `DTEND;VALUE=DATE:${dates.end}`,
      `SUMMARY:${escapeIcs(item.name)}`,
      `LOCATION:${escapeIcs(location)}`,
      `DESCRIPTION:${escapeIcs(`Official information: ${item.officialUrl}`)}`,
      `URL:${item.officialUrl.replace(/\r|\n/g, "")}`,
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
    "",
  ]
    .map(foldCalendarLine)
    .join("\r\n");
}

export function calendarUrls(item: Festival) {
  const range = calendarDates(item);
  if (!range) return null;
  const dates = `${range.start}/${range.end}`;
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
