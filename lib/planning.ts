import type { Festival } from "@/lib/domain/festival";

export function festivalArtists(item: Festival) {
  return new Set([...item.headliners, ...item.lineup].map((artist) => artist.toLocaleLowerCase()));
}

export function lineupOverlap(items: Festival[]) {
  if (items.length < 2) return [];
  const [first, ...rest] = items.map(festivalArtists);
  return [...first].filter((artist) => rest.every((set) => set.has(artist))).sort();
}

export function similarFestivals(item: Festival, festivals: Festival[], limit = 3) {
  const artists = festivalArtists(item);
  return festivals
    .filter((candidate) => candidate.slug !== item.slug)
    .map((candidate) => ({
      festival: candidate,
      shared: [...festivalArtists(candidate)].filter((artist) => artists.has(artist)).length,
    }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || a.festival.name.localeCompare(b.festival.name))
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
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

type CalendarEvent = Pick<
  Festival,
  "slug" | "editionYear" | "name" | "city" | "country" | "officialUrl" | "startDate" | "endDate"
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

export function calendarFile(items: CalendarEvent[], generatedAt = new Date()) {
  const events = items
    .filter((item) => item.startDate)
    .flatMap((item) => {
      const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const location = [item.city, item.country].filter(Boolean).join(", ");
      return [
        "BEGIN:VEVENT",
        `UID:${item.calendarId ?? `${item.slug}-${item.editionYear || 2027}`}@festival-radar`,
        `DTSTAMP:${calendarStamp(item.calendarUpdatedAt ?? item.updatedAt, generatedAt)}`,
        `DTSTART;VALUE=DATE:${compactDate(item.startDate!)}`,
        `DTEND;VALUE=DATE:${compactDate(end.toISOString().slice(0, 10))}`,
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
