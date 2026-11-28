"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import { formatFestivalDateRange } from "@/lib/festival-dates";
import { personalCalendar } from "@/lib/personal-calendar";
import { calendarFile } from "@/lib/planning";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner } from "./LocalPlanner";

const copy = {
  en: {
    title: "My calendar",
    empty: "Mark a festival Going or Maybe to add it here.",
    conflicts: "Overlapping festival dates",
    unknown: "Dates unknown; not included in the export or conflict check.",
    download: "Download my calendar",
  },
  de: {
    title: "Mein Kalender",
    empty: "Markiere ein Festival mit „Dabei“ oder „Vielleicht“.",
    conflicts: "Überschneidende Festivaltermine",
    unknown: "Termine unbekannt; nicht im Export oder in der Überschneidungsprüfung enthalten.",
    download: "Meinen Kalender herunterladen",
  },
  ru: {
    title: "Мой календарь",
    empty: "Выберите «Иду» или «Возможно» у фестиваля, чтобы добавить его сюда.",
    conflicts: "Пересекающиеся даты фестивалей",
    unknown: "Даты неизвестны. Эти фестивали не участвуют в экспорте и проверке пересечений.",
    download: "Скачать мой календарь",
  },
};

export function PersonalCalendar({ festivals }: { festivals: Festival[] }) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  const { attendance } = useLocalPlanner();
  const { dated, undated, conflicts } = personalCalendar(festivals, attendance);
  const festivalLink = (item: Festival) => (
    <Link
      href={
        item.editionYear
          ? `/festivals/${item.slug}/${item.editionYear}/`
          : `/festivals/${item.slug}/`
      }
    >
      {item.name}
    </Link>
  );

  return (
    <section className="plannerSection personalCalendar" aria-labelledby="personal-calendar-title">
      <h2 id="personal-calendar-title">{t.title}</h2>
      {!dated.length && !undated.length && <p>{t.empty}</p>}
      <div aria-live="polite">
        {!!conflicts.length && (
          <div className="personalCalendarConflicts">
            <h3>{t.conflicts}</h3>
            <ul>
              {conflicts.map(({ first, second, range }) => (
                <li key={JSON.stringify([first.slug, second.slug])}>
                  {festivalLink(first)} · {festivalLink(second)} —{" "}
                  {formatFestivalDateRange(range, locale, "")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!!dated.length && (
        <>
          <ol>
            {dated.map((item) => (
              <li key={item.slug}>
                {festivalLink(item)} — {formatFestivalDateRange(item, locale, "")}
              </li>
            ))}
          </ol>
          <a
            className="primaryButton"
            download="loud-weekend-my-calendar.ics"
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`}
          >
            {t.download}
          </a>
        </>
      )}
      {!!undated.length && (
        <>
          <p>{t.unknown}</p>
          <ul>
            {undated.map((item) => (
              <li key={item.slug}>{festivalLink(item)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
