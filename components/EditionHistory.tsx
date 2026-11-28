"use client";

import Link from "next/link";
import { publicHistoryCopy } from "@/lib/catalog/public-history-copy";
import type { EditionHistoryEntry } from "@/lib/catalog/public-history";
import { useLanguage } from "./LanguageProvider";

export function EditionHistory({
  entries,
  officialUrl,
}: {
  entries: EditionHistoryEntry[];
  officialUrl: string;
}) {
  const { language, locale } = useLanguage();
  const copy = publicHistoryCopy[language];
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
                {entry.sourceUrl && (
                  <p>
                    <a href={entry.sourceUrl} rel="noreferrer">
                      {copy.changeSource}
                    </a>
                  </p>
                )}
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
      <p>
        <Link href={`/${language}/announcements/`}>{copy.timeline}</Link>
      </p>
    </section>
  );
}
