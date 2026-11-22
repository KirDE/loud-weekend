import type { Festival } from "@/lib/domain/festival";
import { editionOnHiatus } from "./edition-lifecycle.ts";
import { festivalDateInterval } from "./festival-dates.ts";

import { announcedArtists } from "./festival-lineup.ts";

export function festivalArtists(item: Festival) {
  return new Set(announcedArtists(item).map((artist) => artist.toLocaleLowerCase()));
}

export function lineupOverlap(items: Festival[]) {
  if (items.length < 2) return [];
  const [first, ...rest] = items.map(festivalArtists);
  return [...first].filter((artist) => rest.every((set) => set.has(artist))).sort();
}

export function similarFestivals(item: Festival, festivals: Festival[], limit = 3) {
  const artists = festivalArtists(item);
  return festivals.filter((candidate) => candidate.slug !== item.slug).map((candidate) => ({
    festival: candidate,
    shared: [...festivalArtists(candidate)].filter((artist) => artists.has(artist)).length,
  })).filter(({ shared }) => shared > 0).sort((a, b) => b.shared - a.shared || a.festival.name.localeCompare(b.festival.name)).slice(0, limit);
}

function compactDate(value: string) { return value.replaceAll("-", ""); }

function escapeIcs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll(/\r?\n/g, "\\n");
}

/** Scheduled calendar eligibility, not a mutation of canonical date facts. */
export function calendarEligible(item: Festival): boolean {
  return !editionOnHiatus(item) && festivalDateInterval(item) !== null;
}

export function calendarFile(items: Festival[]) {
  const events = items.filter(calendarEligible).flatMap((item) => {
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
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "PRODID:-//Loud Weekend//European Festivals//EN", ...events, "END:VCALENDAR"].join("\r\n");
}

export function calendarUrls(item: Festival) {
  if (!calendarEligible(item)) return null;
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const exclusiveEnd = end.toISOString().slice(0, 10);
  const dates = `${compactDate(item.startDate!)}/${compactDate(exclusiveEnd)}`;
  const details = `Official information: ${item.officialUrl}`;
  const query = new URLSearchParams({ action: "TEMPLATE", text: item.name, dates, details, location: [item.city, item.country].filter(Boolean).join(", ") });
  return {
    google: `https://calendar.google.com/calendar/render?${query}`,
    ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile([item]))}`,
    apple: `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile([item]))}`,
  };
}
