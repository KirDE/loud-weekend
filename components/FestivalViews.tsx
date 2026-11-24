"use client";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { Festival } from "@/lib/domain/festival";
import {
  festivalDateInterval,
  festivalOverlapsMonth,
  formatFestivalDateRange,
  monthIndex,
} from "@/lib/festival-dates";
import { calendarEligible, calendarFile } from "@/lib/planning";
import { useLanguage, type Language } from "./LanguageProvider";

const labels: Record<
  Language,
  {
    months: string[];
    dates: string;
    calendar: string;
    previous: string;
    next: string;
    until: string;
    noDates: string;
    download: string;
    area: string;
    map: string;
    mapHelp: string;
    mapLabel: string;
    europe: string;
    places: string;
    emptyMap: string;
    marker: (country: string, count: number) => string;
  }
> = {
  en: {
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    dates: "DATES AT A GLANCE",
    calendar: "Festival calendar",
    previous: "Previous month",
    next: "Next month",
    until: "Until",
    noDates: "No confirmed dates in this month yet.",
    download: "Download full festival calendar",
    area: "EUROPE-WIDE",
    map: "Festival map",
    mapHelp: "Markers group festivals by country. Open a marker to choose a festival.",
    mapLabel: "Map of Europe with festival markers",
    europe: "EUROPE",
    places: "Festivals by country (list)",
    emptyMap: "No festivals to list.",
    marker: (country, count) => `${country}: ${count} festivals`,
  },
  de: {
    months: [
      "Januar",
      "Februar",
      "März",
      "April",
      "Mai",
      "Juni",
      "Juli",
      "August",
      "September",
      "Oktober",
      "November",
      "Dezember",
    ],
    dates: "TERMINE AUF EINEN BLICK",
    calendar: "Festivalkalender",
    previous: "Vorheriger Monat",
    next: "Nächster Monat",
    until: "Bis",
    noDates: "Für diesen Monat gibt es noch keine bestätigten Termine.",
    download: "Vollständigen Festivalkalender herunterladen",
    area: "EUROPAWEIT",
    map: "Festivalkarte",
    mapHelp:
      "Die Markierungen gruppieren Festivals nach Ländern. Öffne eine Markierung, um ein Festival auszuwählen.",
    mapLabel: "Europakarte mit Festival-Markierungen",
    europe: "EUROPA",
    places: "Festivals nach Land (Liste)",
    emptyMap: "Keine Festivals vorhanden.",
    marker: (country, count) => `${country}: ${count} Festivals`,
  },
  ru: {
    months: [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ],
    dates: "ДАТЫ ОДНИМ ВЗГЛЯДОМ",
    calendar: "Календарь фестивалей",
    previous: "Предыдущий месяц",
    next: "Следующий месяц",
    until: "До",
    noDates: "На этот месяц пока нет подтверждённых дат.",
    download: "Скачать полный календарь фестивалей",
    area: "ПО ВСЕЙ ЕВРОПЕ",
    map: "Карта фестивалей",
    mapHelp: "Метки объединяют фестивали по странам. Откройте метку, чтобы выбрать фестиваль.",
    mapLabel: "Карта Европы с метками фестивалей",
    europe: "ЕВРОПА",
    places: "Фестивали по странам (список)",
    emptyMap: "Фестивалей нет.",
    marker: (country, count) => `${country}: фестивалей — ${count}`,
  },
};
const POINTS: Record<string, [number, number]> = {
  AT: [57, 61],
  BE: [42, 45],
  CH: [48, 64],
  CZ: [60, 49],
  DE: [51, 47],
  DK: [52, 31],
  ES: [29, 75],
  FI: [72, 16],
  FR: [39, 61],
  GB: [29, 40],
  IT: [55, 75],
  NL: [44, 39],
  NO: [48, 15],
  PL: [68, 45],
  RO: [76, 64],
  SE: [58, 17],
  SI: [70, 74],
};

export function FestivalViews({ festivals }: { festivals: Festival[] }) {
  const { language, locale } = useLanguage();
  const t = labels[language];
  const mapId = useId();
  const [openMarker, setOpenMarker] = useState<string>();
  const mapGroups = useMemo(() => {
    const countries = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    const groups = new Map<string, { country: string; items: Festival[] }>();
    for (const festival of festivals) {
      const { country, countryCode } = festival;
      const label = /^[A-Z]{2}$/.test(countryCode)
        ? (countries.of(countryCode) ?? country)
        : country;
      const group = groups.get(countryCode) ?? { country: label, items: [] };
      group.items.push(festival);
      groups.set(countryCode, group);
    }
    return [...groups].sort(([, a], [, b]) => a.country.localeCompare(b.country, locale));
  }, [festivals, locale]);
  const dated = useMemo(
    () =>
      festivals.filter(calendarEligible).sort((a, b) => a.startDate!.localeCompare(b.startDate!)),
    [festivals],
  );
  const [selectedMonth, setSelectedMonth] = useState(() =>
    dated[0]
      ? monthIndex(festivalDateInterval(dated[0])!.start)
      : (festivals[0]?.editionYear ?? 2027) * 12,
  );
  const year = Math.floor(selectedMonth / 12);
  const month = selectedMonth - year * 12;
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const visible = dated.filter((f) => festivalOverlapsMonth(f, month + 1, year));
  return (
    <>
      <section className="plannerSection" aria-labelledby="festival-calendar-title">
        <div className="viewHeading">
          <div>
            <div className="eyebrow">{t.dates}</div>
            <h2 id="festival-calendar-title">{t.calendar}</h2>
          </div>
          <div className="monthNav">
            <button onClick={() => setSelectedMonth((value) => value - 1)} aria-label={t.previous}>
              ←
            </button>
            <strong role="status" aria-live="polite" aria-atomic="true">
              {t.months[month]} {year}
            </strong>
            <button onClick={() => setSelectedMonth((value) => value + 1)} aria-label={t.next}>
              →
            </button>
          </div>
        </div>
        <div className="calendarGrid" role="list">
          {visible.length ? (
            visible.map((f) => {
              const firstVisibleDate = f.startDate! < monthStart ? monthStart : f.startDate!;
              return (
                <Link role="listitem" href={`/festivals/${f.slug}/`} key={f.slug}>
                  <time dateTime={firstVisibleDate}>{Number(firstVisibleDate.slice(8, 10))}</time>
                  <span>
                    <strong>{f.name}</strong>
                    <small>
                      {formatFestivalDateRange(f, locale, t.noDates)} · {f.city || f.country}
                    </small>
                  </span>
                </Link>
              );
            })
          ) : (
            <p>{t.noDates}</p>
          )}
        </div>
        <a
          className="primaryButton"
          href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`}
          download="loud-weekend-festivals.ics"
        >
          {t.download}
        </a>
      </section>
      <section className="plannerSection" aria-labelledby="festival-map-title">
        <div className="viewHeading">
          <div>
            <div className="eyebrow">{t.area}</div>
            <h2 id="festival-map-title">{t.map}</h2>
          </div>
          <p>{t.mapHelp}</p>
        </div>
        {mapGroups.some(([code, { items }]) => POINTS[code] && items.some(({ city }) => city)) && (
          <div className="europeMap" role="group" aria-label={t.mapLabel}>
            <div className="mapLand" aria-hidden="true">
              {t.europe}
            </div>
            {mapGroups.map(([code, { country, items }]) => {
              const point = POINTS[code];
              const mapped = items.filter(({ city }) => city);
              if (!point || !mapped.length) return null;
              const [left, top] = point;
              const isOpen = openMarker === code;
              const panelId = `${mapId}-${code}`;
              return (
                <div
                  className="mapMarker"
                  data-open={isOpen}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  key={code}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !isOpen) return;
                    event.preventDefault();
                    setOpenMarker(undefined);
                    event.currentTarget.querySelector("button")?.focus();
                  }}
                >
                  <button
                    type="button"
                    aria-label={t.marker(country, mapped.length)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenMarker(isOpen ? undefined : code)}
                  >
                    {mapped.length}
                    <span>{code}</span>
                  </button>
                  <div id={panelId} hidden={!isOpen}>
                    {mapped.map((f) => (
                      <Link href={`/festivals/${f.slug}/`} key={f.slug}>
                        <strong>{f.name}</strong>
                        <small>{f.city}</small>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <details className="mapTextList">
          <summary>{t.places}</summary>
          {mapGroups.length ? (
            <ul>
              {mapGroups.map(([code, { country, items }]) => (
                <li key={code}>
                  <strong>{country}</strong>
                  <ul>
                    {items.map((f) => (
                      <li key={f.slug}>
                        <Link href={`/festivals/${f.slug}/`}>
                          {f.name}
                          {f.city ? ` · ${f.city}` : ""}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t.emptyMap}</p>
          )}
        </details>
      </section>
    </>
  );
}
