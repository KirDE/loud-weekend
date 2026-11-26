import type { EditionVenue } from "@prisma/client";
import type { Festival, FestivalVenue } from "../domain/festival.ts";

export function venueSourceHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) {
      return url.hostname.replace(/^www\./, "");
    }
  } catch {
    // Invalid URLs do not establish organizer identity.
  }
}

export function sameVenueCity(city: string | undefined, reviewed: string) {
  const key = (value: string) =>
    value.trim().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return !!city && key(city) === key(reviewed);
}

export function publicFestivalVenue(
  venue: EditionVenue | null | undefined,
  festival: Pick<Festival, "editionYear" | "countryCode" | "city" | "officialUrl">,
): FestivalVenue | undefined {
  if (
    !venue ||
    venue.editionYear !== festival.editionYear ||
    venue.countryCode !== festival.countryCode ||
    !sameVenueCity(festival.city, venue.city) ||
    venueSourceHost(festival.officialUrl) !== venue.organizerHost ||
    venueSourceHost(venue.sourceUrl) !== venue.organizerHost
  )
    return;
  const { latitude, longitude, name, sourceUrl, checkedOn } = venue;
  return {
    latitude,
    longitude,
    name,
    source: sourceUrl,
    checkedOn: checkedOn.toISOString().slice(0, 10),
  };
}
