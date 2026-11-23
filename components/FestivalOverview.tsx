"use client";

import type { Festival } from "@/lib/domain/festival";
import { festivalOverview } from "@/lib/catalog/festival-overviews";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: { title: "About this festival", source: "Official source", checked: "Sources reviewed" },
  de: { title: "Über dieses Festival", source: "Offizielle Quelle", checked: "Quellen geprüft" },
  ru: { title: "О фестивале", source: "Официальный источник", checked: "Источники проверены" },
};

export function FestivalOverview({ festival }: { festival: Festival }) {
  const { language, locale } = useLanguage();
  const overview = festivalOverview(festival);
  if (!overview) return null;
  const copy = labels[language];
  const date = new Date(`${overview.checkedOn}T00:00:00Z`);
  return (
    <section className="sourceNote" aria-labelledby="festival-overview-title">
      <h2 id="festival-overview-title">{copy.title}</h2>
      <p>{overview.summary[language]}</p>
      <p>{copy.checked}: <time dateTime={overview.checkedOn}>
        {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date)}
      </time></p>
      <ul>
        {overview.sources.map((source) => (
          <li key={source}>
            <a href={source} rel="noreferrer">{copy.source}: {new URL(source).hostname}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
