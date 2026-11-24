"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import { calendarUrls, similarFestivals } from "@/lib/planning";
import { StageTimetable } from "./StageTimetable";
import { useLanguage, type Language } from "./LanguageProvider";

const copy: Record<
  Language,
  {
    eyebrow: string;
    calendar: string;
    download: string;
    apple: string;
    pending: string;
    map: string;
    shared: (count: number) => string;
  }
> = {
  en: {
    eyebrow: "PLAN THE TRIP",
    calendar: "Calendar & map",
    download: "Download .ics",
    apple: "Add to Apple Calendar",
    pending: "Calendar export unlocks when dates are announced.",
    map: "Open European map ↗",
    shared: (count) => `${count} shared act${count === 1 ? "" : "s"}`,
  },
  de: {
    eyebrow: "REISE PLANEN",
    calendar: "Kalender & Karte",
    download: ".ics herunterladen",
    apple: "Zu Apple Kalender hinzufügen",
    pending: "Der Kalenderexport ist verfügbar, sobald die Termine bekannt sind.",
    map: "Europakarte öffnen ↗",
    shared: (count) => `${count} gemeinsame Künstler`,
  },
  ru: {
    eyebrow: "ПЛАНИРОВАНИЕ ПОЕЗДКИ",
    calendar: "Календарь и карта",
    download: "Скачать .ics",
    apple: "Добавить в Apple Calendar",
    pending: "Экспорт в календарь появится после объявления дат.",
    map: "Открыть карту Европы ↗",
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
  festivals,
  discoveryLineups,
  favorites,
}: {
  item: Festival;
  festivals: Festival[];
  discoveryLineups?: DiscoveryLineups;
  favorites?: readonly string[];
}) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  const reasons = relatedCopy[language];
  const numbers = new Intl.NumberFormat(locale);
  const kilometers = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
  });
  const calendar = calendarUrls(item);
  const location = [item.city, item.country].filter(Boolean).join(", ");
  const map = `https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}`;
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
            <a href={calendar.ics} download={`${item.slug}-2027.ics`}>
              {t.download}
            </a>
            <a href={calendar.google} target="_blank" rel="noreferrer">
              Google Calendar ↗
            </a>
            <a href={calendar.apple} download={`${item.slug}-apple-calendar-2027.ics`}>
              {t.apple}
            </a>
          </>
        ) : (
          <span>{t.pending}</span>
        )}
        <a href={map} target="_blank" rel="noreferrer">
          {t.map}
        </a>
      </div>
      <StageTimetable entries={item.timetable} slug={item.slug} year={item.editionYear} />
      {similar.length > 0 && (
        <div className="recommendations">
          <h3>{reasons.title}</h3>
          {similar.map(({ festival, shared, favoriteCount, sharedGenres, gapDays, distance }) => (
            <Link href={`/${language}/festivals/${festival.slug}/`} key={festival.slug}>
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
