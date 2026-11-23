"use client";

import { useId } from "react";
import { arrivalFacts } from "@/lib/catalog/arrival-facts";
import type { Festival } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: { title: "Venue and arrival", venue: "Festival venue", shuttle: "Paid shuttles", railShuttle: "Shuttles from railway stations", camper: "Arriving at the campsite by vehicle", source: "Organizer’s information", checked: "Sources checked" },
  de: { title: "Veranstaltungsort und Anreise", venue: "Festivalgelände", shuttle: "Kostenpflichtige Shuttles", railShuttle: "Shuttles ab Bahnhöfen", camper: "Anreise zum Campingplatz mit Fahrzeug", source: "Informationen des Veranstalters", checked: "Quellen geprüft" },
  ru: { title: "Место проведения и проезд", venue: "Площадка фестиваля", shuttle: "Платные шаттлы", railShuttle: "Шаттлы от вокзалов", camper: "Въезд в кемпинг на автомобиле", source: "Информация организатора", checked: "Источники проверены" },
} as const;

export function FestivalArrival({ festival }: { festival: Pick<Festival, "slug" | "officialUrl" | "editionYear" | "countryCode"> }) {
  const { language, locale } = useLanguage();
  const titleId = useId();
  const record = arrivalFacts(festival);
  if (!record) return null;
  const t = labels[language];
  const reviewed = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(record.checkedOn + "T00:00:00Z"));

  return (
    <section className="sourceNote" aria-labelledby={titleId}>
      <h2 id={titleId}>{t.title}</h2>
      <dl>
        {record.facts.map((fact, index) => {
          const labelId = `${titleId}-fact-${index}`;
          const linkId = `${labelId}-source`;
          return (
            <div key={fact.kind}>
              <dt id={labelId}><strong>{t[fact.kind]}</strong></dt>
              <dd>
                {fact.description[language]}{" "}
                <a id={linkId} href={fact.source} rel="noreferrer" aria-labelledby={`${linkId} ${labelId}`}>{t.source}</a>
              </dd>
            </div>
          );
        })}
      </dl>
      <p>{t.checked}: <time dateTime={record.checkedOn}>{reviewed}</time></p>
    </section>
  );
}
