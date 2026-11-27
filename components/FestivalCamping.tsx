"use client";

import { useId } from "react";
import type { PublicCampingFact } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: {
    title: "Camping and on-site facilities",
    camping: "Camping ticket",
    arrival: "Earliest campsite arrival date",
    accessibility: "Designated camping area",
    facilities: "Showers and toilets",
    motorhomes: "Motorhome pitches",
    viewing: "Accessible viewing platforms",
    source: "Organizer’s camping information",
    reviewed: "Source checked",
  },
  de: {
    title: "Camping und Ausstattung",
    camping: "Campingticket",
    arrival: "Frühester Anreisetag zum Campingplatz",
    accessibility: "Ausgewiesener Campingbereich",
    facilities: "Duschen und Toiletten",
    motorhomes: "Wohnmobilstellplätze",
    viewing: "Barrierefreie Zuschauerplattformen",
    source: "Campinginformationen des Veranstalters",
    reviewed: "Quelle geprüft",
  },
  ru: {
    title: "Кемпинг и удобства",
    camping: "Билет в кемпинг",
    arrival: "Первый день заезда в кемпинг",
    accessibility: "Выделенная зона кемпинга",
    facilities: "Душевые и туалеты",
    motorhomes: "Места для автодомов",
    viewing: "Доступные зрительские площадки",
    source: "Информация о кемпинге от организатора",
    reviewed: "Источник проверен",
  },
};

export function FestivalCamping({
  facts,
  compact = false,
}: {
  facts: readonly PublicCampingFact[];
  compact?: boolean;
}) {
  const { language, locale } = useLanguage();
  const titleId = useId();
  if (!facts.length) return null;
  const t = copy[language];
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const displayDate = (date: string) => formatter.format(new Date(date + "T00:00:00Z"));
  const groups = new Map<string, PublicCampingFact[]>();
  for (const fact of facts) {
    const key = JSON.stringify([fact.sourceUrl, fact.checkedOn]);
    const group = groups.get(key);
    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }
  const content = (
    <>
      {Array.from(groups, ([key, group]) => (
        <div key={key}>
          <dl>
            {group.map((fact) => (
              <div key={fact.field}>
                <dt>
                  <strong>{t[fact.field]}</strong>
                </dt>
                <dd>
                  {fact.field === "arrival" ? (
                    <time dateTime={fact.earliestDate}>{displayDate(fact.earliestDate)}</time>
                  ) : (
                    fact.description[language]
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            <a href={group[0].sourceUrl} rel="noreferrer">
              {t.source}
            </a>
            {" · "}
            {t.reviewed}:{" "}
            <time dateTime={group[0].checkedOn}>{displayDate(group[0].checkedOn)}</time>
          </p>
        </div>
      ))}
    </>
  );
  return compact ? (
    content
  ) : (
    <section className="sourceNote" aria-labelledby={titleId}>
      <h2 id={titleId}>{t.title}</h2>
      {content}
    </section>
  );
}
