"use client";

import Link from "next/link";
import { formatFestivalDateRange } from "@/lib/festival-dates";
import { festivalGuides, type GuideTopic } from "@/lib/festival-guides";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: {
    checklist: "Before booking",
    matched: "Editions that meet these criteria",
    empty: "No current edition meets these criteria yet.",
    browse: "Browse the festival catalogue",
  },
  de: {
    checklist: "Vor der Buchung",
    matched: "Ausgaben, die diese Kriterien erfüllen",
    empty: "Noch keine aktuelle Ausgabe erfüllt diese Kriterien.",
    browse: "Zum Festivalkatalog",
  },
  ru: {
    checklist: "Перед бронированием",
    matched: "Фестивали, отвечающие критериям",
    empty: "Пока ни один актуальный фестиваль не отвечает этим критериям.",
    browse: "Смотреть каталог фестивалей",
  },
};

type GuideItem = {
  slug: string;
  editionYear: number;
  name: string;
  startDate?: string;
  endDate?: string;
};

export function FestivalGuideContent({ topic, items }: { topic: GuideTopic; items: GuideItem[] }) {
  const { language, locale } = useLanguage();
  const copy = festivalGuides[topic][language];
  const text = labels[language];
  const prefix = `/${language}`;
  return (
    <article className="directoryPage" lang={language}>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      <section>
        <h2>{text.checklist}</h2>
        <ul>
          {copy.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>{text.matched}</h2>
        <p>{copy.criterion}</p>
        {items.length ? (
          <ul>
            {items.map((item) => (
              <li key={`${item.slug}:${item.editionYear}`}>
                <Link href={`/festivals/${item.slug}/${item.editionYear}/`}>{item.name}</Link> —{" "}
                {formatFestivalDateRange(item, locale, "")}
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.empty}</p>
        )}
      </section>
      <Link href={`${prefix}/`}>{text.browse}</Link>
    </article>
  );
}
