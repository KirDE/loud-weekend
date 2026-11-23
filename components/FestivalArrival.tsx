"use client";

import { useId } from "react";
import type { PublicArrivalFact } from "@/lib/catalog/arrival-facts";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: { title: "Venue and arrival", venue: "Festival venue", shuttle: "Paid shuttles", railShuttle: "Shuttles from railway stations", camper: "Arriving at the campsite by vehicle", source: "Organizer’s information", checked: "Sources checked" },
  de: { title: "Veranstaltungsort und Anreise", venue: "Festivalgelände", shuttle: "Kostenpflichtige Shuttles", railShuttle: "Shuttles ab Bahnhöfen", camper: "Anreise zum Campingplatz mit Fahrzeug", source: "Informationen des Veranstalters", checked: "Quellen geprüft" },
  ru: { title: "Место проведения и проезд", venue: "Площадка фестиваля", shuttle: "Платные шаттлы", railShuttle: "Шаттлы от вокзалов", camper: "Въезд в кемпинг на автомобиле", source: "Информация организатора", checked: "Источники проверены" },
} as const;

export function FestivalArrival({ facts }: { facts: readonly PublicArrivalFact[] }) {
  const { language, locale } = useLanguage();
  const titleId = useId();
  if (!facts.length) return null;
  const t = labels[language];
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <section className="sourceNote" aria-labelledby={titleId}>
      <h2 id={titleId}>{t.title}</h2>
      <dl>
        {facts.map((fact, index) => {
          const labelId = `${titleId}-fact-${index}`;
          const linkId = `${labelId}-source`;
          return (
            <div key={fact.kind}>
              <dt id={labelId}><strong>{t[fact.kind]}</strong></dt>
              <dd>
                {fact.description[language]}{" "}
                <a id={linkId} href={fact.sourceUrl} rel="noreferrer" aria-labelledby={`${linkId} ${labelId}`}>{t.source}</a>
                <small> · {t.checked}: <time dateTime={fact.checkedOn}>
                  {formatDate.format(new Date(fact.checkedOn + "T00:00:00Z"))}
                </time></small>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
