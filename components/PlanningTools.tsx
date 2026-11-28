"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import { editionOnHiatus } from "@/lib/edition-lifecycle";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import { calendarUrls, similarFestivals } from "@/lib/planning";
import { StageTimetable } from "./StageTimetable";
import { useLanguage, translate, type Language } from "./LanguageProvider";

const copy: Record<
  Language,
  {
    eyebrow: string;
    calendar: string;
    download: string;
    apple: string;
    pending: string;
    venueMap: string;
    cityMap: string;
    shared: (count: number) => string;
  }
> = {
  en: {
    eyebrow: "PLAN THE TRIP",
    calendar: "Calendar & map",
    download: "Download .ics",
    apple: "Add to Apple Calendar",
    pending: "Calendar export unlocks when dates are announced.",
    venueMap: "Find the venue on OpenStreetMap ↗",
    cityMap: "Find the city on OpenStreetMap ↗",
    shared: (count) => `${count} shared act${count === 1 ? "" : "s"}`,
  },
  de: {
    eyebrow: "REISE PLANEN",
    calendar: "Kalender & Karte",
    download: ".ics herunterladen",
    apple: "Zu Apple Kalender hinzufügen",
    pending: "Der Kalenderexport ist verfügbar, sobald die Termine bekannt sind.",
    venueMap: "Festivalgelände auf OpenStreetMap suchen ↗",
    cityMap: "Stadt auf OpenStreetMap suchen ↗",
    shared: (count) => `${count} gemeinsame Künstler`,
  },
  ru: {
    eyebrow: "ПЛАНИРОВАНИЕ ПОЕЗДКИ",
    calendar: "Календарь и карта",
    download: "Скачать .ics",
    apple: "Добавить в Apple Calendar",
    pending: "Экспорт в календарь появится после объявления дат.",
    venueMap: "Найти площадку на OpenStreetMap ↗",
    cityMap: "Найти город на OpenStreetMap ↗",
    shared: (count) => `Общих артистов: ${count}`,
  },
};

const relatedCopy = {
  en: {
    title: "Related festivals",
    favorite: "Favorite acts",
    genres: "Shared genres",
    overlap: "Dates overlap",
    nearby: "Days between festivals",
    straightLine: "Straight-line distance",
  },
  de: {
    title: "Verwandte Festivals",
    favorite: "Lieblingskünstler",
    genres: "Gemeinsame Genres",
    overlap: "Termine überschneiden sich",
    nearby: "Tage zwischen den Festivals",
    straightLine: "Luftlinie",
  },
  ru: {
    title: "Связанные фестивали",
    favorite: "Избранные исполнители",
    genres: "Общие жанры",
    overlap: "Даты пересекаются",
    nearby: "Дней между фестивалями",
    straightLine: "Расстояние по прямой",
  },
};

export function PlanningTools({
  item,
  venueAddress,
  festivals,
  discoveryLineups,
  favorites,
}: {
  item: Festival;
  venueAddress?: string;
  festivals: Festival[];
  discoveryLineups?: DiscoveryLineups;
  favorites?: readonly string[];
}) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  const hiatus = editionOnHiatus(item);
  const reasons = relatedCopy[language];
  const numbers = new Intl.NumberFormat(locale);
  const kilometers = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
  });
  const calendar = calendarUrls(item);
  const yearSuffix = item.editionYear ? `-${item.editionYear}` : "";
  const venue = hiatus ? undefined : item.venue;
  const address = hiatus ? undefined : venueAddress?.trim();
  const location = address || (item.city?.trim() && `${item.city.trim()}, ${item.country}`);
  const mapRoot = "https://www.openstreetmap.org";
  const map = venue
    ? `${mapRoot}/?mlat=${venue.latitude}&mlon=${venue.longitude}#map=17/${venue.latitude}/${venue.longitude}`
    : location
      ? `${mapRoot}/search?query=${encodeURIComponent(location)}`
      : null;
  const similar = similarFestivals(item, festivals, {
    lineups: discoveryLineups,
    favorites,
    locale,
  });
  return (
    <section className="planningSection">
      <div className="sectionHeading">
        <div>
          <div className="eyebrow">{t.eyebrow}</div>
          <h2>{t.calendar}</h2>
        </div>
      </div>
      <div className="planningActions">
        {calendar ? (
          <>
            <a href={calendar.ics} download={`${item.slug}${yearSuffix}.ics`}>
              {t.download}
            </a>
            <a href={calendar.google} target="_blank" rel="noreferrer">
              Google Calendar ↗
            </a>
            <a href={calendar.apple} download={`${item.slug}-apple-calendar${yearSuffix}.ics`}>
              {t.apple}
            </a>
          </>
        ) : (
          <span>{hiatus ? translate(language, "editionHiatus") : t.pending}</span>
        )}
        {map && (
          <a href={map} target="_blank" rel="noreferrer">
            {venue || address ? t.venueMap : t.cityMap}
          </a>
        )}
      </div>
      {!hiatus && (
        <StageTimetable entries={item.timetable} slug={item.slug} year={item.editionYear} />
      )}
      {similar.length > 0 && (
        <div className="recommendations">
          <h3>{reasons.title}</h3>
          {similar.map(({ festival, shared, favoriteCount, sharedGenres, gapDays, distance }) => (
            <Link
              href={`/${language}/festivals/${festival.slug}/${festival.editionYear ? `${festival.editionYear}/` : ""}`}
              key={festival.slug}
            >
              <strong>{festival.name}</strong>
              <span>
                {[
                  shared > 0 ? t.shared(shared) : null,
                  favoriteCount > 0
                    ? `${reasons.favorite}: ${numbers.format(favoriteCount)}`
                    : null,
                  sharedGenres.length ? `${reasons.genres}: ${sharedGenres.join(", ")}` : null,
                  gapDays === 0
                    ? reasons.overlap
                    : gapDays !== null
                      ? `${reasons.nearby}: ${numbers.format(gapDays)}`
                      : null,
                  distance !== null
                    ? `${reasons.straightLine}: ${kilometers.format(distance)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
