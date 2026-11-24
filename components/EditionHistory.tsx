"use client";

import type { EditionHistoryEntry } from "@/lib/catalog/public-history";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    title: "Published changes",
    dates: "Dates updated",
    lineup: "Lineup updated",
    tickets: "Ticket information updated",
    timetable: "Timetable updated",
    empty: "No published changes recorded for this edition.",
    official: "Official festival site",
  },
  de: {
    title: "Veröffentlichte Änderungen",
    dates: "Termine aktualisiert",
    lineup: "Line-up aktualisiert",
    tickets: "Ticketinformationen aktualisiert",
    timetable: "Zeitplan aktualisiert",
    empty: "Für diese Ausgabe sind keine veröffentlichten Änderungen erfasst.",
    official: "Offizielle Festival-Website",
  },
  ru: {
    title: "Опубликованные изменения",
    dates: "Даты обновлены",
    lineup: "Лайнап обновлён",
    tickets: "Информация о билетах обновлена",
    timetable: "Расписание обновлено",
    empty: "Для этого выпуска нет записей об опубликованных изменениях.",
    official: "Официальный сайт фестиваля",
  },
};

export function EditionHistory({
  entries,
  officialUrl,
}: {
  entries: EditionHistoryEntry[];
  officialUrl: string;
}) {
  const { language, locale } = useLanguage();
  const copy = labels[language];
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return (
    <section className="detailPage editionHistory" aria-labelledby="edition-history">
      <h2 id="edition-history">{copy.title}</h2>
      {entries.length ? (
        <>
          <ol>
            {entries.map((entry, index) => (
              <li key={`${entry.publishedAt}:${index}`}>
                <time dateTime={entry.publishedAt}>
                  {format.format(new Date(entry.publishedAt))} UTC
                </time>
                <p>{entry.categories.map((category) => copy[category]).join(" · ")}</p>
              </li>
            ))}
          </ol>
          <a href={officialUrl} rel="noreferrer">
            {copy.official}
          </a>
        </>
      ) : (
        <p>{copy.empty}</p>
      )}
    </section>
  );
}
