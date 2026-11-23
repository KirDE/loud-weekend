"use client";

import type { Festival } from "@/lib/domain/festival";
import { campingFacts } from "@/lib/catalog/camping-facts";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: { title: "Camping and on-site facilities", camping: "Camping ticket", arrival: "Earliest campsite arrival date", accessibility: "Designated camping area", facilities: "Showers and toilets", motorhomes: "Motorhome pitches", source: "Organizer’s camping information", reviewed: "Source checked" },
  de: { title: "Camping und Ausstattung", camping: "Campingticket", arrival: "Frühester Anreisetag zum Campingplatz", accessibility: "Ausgewiesener Campingbereich", facilities: "Duschen und Toiletten", motorhomes: "Wohnmobilstellplätze", source: "Campinginformationen des Veranstalters", reviewed: "Quelle geprüft" },
  ru: { title: "Кемпинг и удобства", camping: "Билет в кемпинг", arrival: "Первый день заезда в кемпинг", accessibility: "Выделенная зона кемпинга", facilities: "Душевые и туалеты", motorhomes: "Места для автодомов", source: "Информация о кемпинге от организатора", reviewed: "Источник проверен" },
};

export function FestivalCamping({ festival }: { festival: Festival }) {
  const { language, locale } = useLanguage();
  const record = campingFacts(festival);
  if (!record) return null;
  const t = copy[language];
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const displayDate = (date: string) => formatter.format(new Date(date + "T00:00:00Z"));
  return (
    <section className="sourceNote" aria-labelledby="camping-facts-title">
      <h2 id="camping-facts-title">{t.title}</h2>
      <dl>
        {record.facts.map(fact => (
          <div key={fact.field}>
            <dt><strong>{t[fact.field]}</strong></dt>
            <dd>{fact.field === "arrival"
              ? <time dateTime={fact.earliestDate}>{displayDate(fact.earliestDate)}</time>
              : fact.description[language]}</dd>
          </div>
        ))}
      </dl>
      <p>
        <a href={record.source} rel="noreferrer">{t.source}</a>
        {" · "}{t.reviewed}: <time dateTime={record.checkedOn}>{displayDate(record.checkedOn)}</time>
      </p>
    </section>
  );
}
