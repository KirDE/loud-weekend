"use client";
import Link from "./CatalogLink";
import { useMemo, useState } from "react";
import type { Festival } from "@/lib/domain/festival";
import {
  festivalDateInterval,
  festivalOverlapsMonth,
  formatFestivalDateRange,
  monthIndex,
} from "@/lib/festival-dates";
import { calendarEligible, calendarFile } from "@/lib/planning";
import { FestivalLocationMap } from "./FestivalLocationMap";
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
    noCalendarDates: string;
    download: string;
    area: string;
    map: string;
    mapHelp: string;
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
    noCalendarDates: "No confirmed festival dates yet.",
    download: "Download full festival calendar",
    area: "EUROPE-WIDE",
    map: "Festival map",
    mapHelp: "Open a marker to see festivals at that location.",
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
    noCalendarDates: "Es gibt noch keine bestätigten Festivaltermine.",
    download: "Vollständigen Festivalkalender herunterladen",
    area: "EUROPAWEIT",
    map: "Festivalkarte",
    mapHelp: "Öffne eine Markierung, um die Festivals an diesem Standort zu sehen.",
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
    noCalendarDates: "Подтверждённых дат фестивалей пока нет.",
    download: "Скачать полный календарь фестивалей",
    area: "ПО ВСЕЙ ЕВРОПЕ",
    map: "Карта фестивалей",
    mapHelp: "Откройте метку, чтобы увидеть фестивали в этом месте.",
  },
};
export function FestivalViews({ festivals }: { festivals: Festival[] }) {
  const { language, locale } = useLanguage();
  const t = labels[language];
  const dated = useMemo(
    () =>
      festivals.filter(calendarEligible).sort((a, b) => a.startDate!.localeCompare(b.startDate!)),
    [festivals],
  );
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const firstDate = dated[0] ? festivalDateInterval(dated[0])?.start : undefined;
  const heading = (
    <div>
      <div className="eyebrow">{t.dates}</div>
      <h2 id="festival-calendar-title">{t.calendar}</h2>
    </div>
  );
  const map = (
    <section className="plannerSection" aria-labelledby="festival-map-title">
      <div className="viewHeading">
        <div>
          <div className="eyebrow">{t.area}</div>
          <h2 id="festival-map-title">{t.map}</h2>
        </div>
        <p>{t.mapHelp}</p>
      </div>
      <FestivalLocationMap festivals={festivals} />
    </section>
  );
  if (!firstDate) {
    return (
      <>
        <section className="plannerSection" aria-labelledby="festival-calendar-title">
          <div className="viewHeading">{heading}</div>
          <p>{t.noCalendarDates}</p>
        </section>
        {map}
      </>
    );
  }
  const firstMonth = monthIndex(firstDate);
  const activeMonth = selectedMonth ?? firstMonth;
  const year = Math.floor(activeMonth / 12);
  const month = activeMonth - year * 12;
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const visible = dated.filter((f) => festivalOverlapsMonth(f, month + 1, year));
  return (
    <>
      <section className="plannerSection" aria-labelledby="festival-calendar-title">
        <div className="viewHeading">
          {heading}
          <div className="monthNav">
            <button
              onClick={() => setSelectedMonth((value) => (value ?? firstMonth) - 1)}
              aria-label={t.previous}
            >
              ←
            </button>
            <strong role="status" aria-live="polite" aria-atomic="true">
              {t.months[month]} {year}
            </strong>
            <button
              onClick={() => setSelectedMonth((value) => (value ?? firstMonth) + 1)}
              aria-label={t.next}
            >
              →
            </button>
          </div>
        </div>
        <div className="calendarGrid" role="list">
          {visible.length ? (
            visible.map((f) => {
              const firstVisibleDate = f.startDate! < monthStart ? monthStart : f.startDate!;
              const href = f.editionYear
                ? `/festivals/${f.slug}/${f.editionYear}/`
                : `/festivals/${f.slug}/`;
              return (
                <Link role="listitem" href={href} key={href}>
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
      {map}
    </>
  );
}
