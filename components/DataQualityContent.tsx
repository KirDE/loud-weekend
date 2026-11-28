"use client";

import Link from "next/link";
import type { summarizeDataQuality } from "@/lib/catalog/data-quality";
import { dataQualityCopy } from "@/lib/data-quality-copy";
import { useLanguage } from "./LanguageProvider";

export function DataQualityContent({ data }: { data?: ReturnType<typeof summarizeDataQuality> }) {
  const { language, locale } = useLanguage();
  const t = dataQualityCopy[language];
  const count = new Intl.NumberFormat(locale);
  const coverageTotal = data ? data.total - data.hiatus : 0;
  const group = (header: string, total: number, rows: readonly (readonly [string, number])[]) => (
    <section>
      <h2>{header}</h2>
      <dl>
        {rows.map(([label, value]) => (
          <div className="dataQualityCount" key={label}>
            <dt>{label}</dt>
            <dd>
              {count.format(value)} / {count.format(total)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <article className="directoryPage">
      <h1>{t.title}</h1>
      {!data ? (
        <p role="status">{t.unavailable}</p>
      ) : data.total === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <>
          <p>{t.intro}</p>
          {data.hiatus > 0 && <p>{t.hiatusExcluded}</p>}
          {coverageTotal > 0 ? (
            group(t.coverage, coverageTotal, [
              [t.dates, data.dates],
              [t.lineup, data.lineup],
              [t.lineupDays, data.lineupDayCoverage],
              [t.tickets, data.tickets],
              [t.ticketCategories, data.ticketCategories],
              [t.timetable, data.timetable],
            ])
          ) : (
            <section>
              <h2>{t.coverage}</h2>
              <p>{t.allPaused}</p>
            </section>
          )}
          {group(t.source, data.total, [
            [t.recent, data.checked],
            [t.stale, data.stale],
            [t.unchecked, data.notChecked],
          ])}
          {data.lastRecentCheck ? (
            <p>
              {t.last}:{" "}
              <time dateTime={data.lastRecentCheck}>
                {new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(
                  new Date(data.lastRecentCheck),
                )}
              </time>
            </p>
          ) : (
            <p>{t.noCheck}</p>
          )}
          {group(t.evidence, data.total, [
            [t.dateEvidence, data.dateEvidence],
            [t.lineupEvidence, data.lineupEvidence],
          ])}
          <p>{t.detail}</p>
        </>
      )}
      <Link className="textLink" href={`/${language}/`}>
        {t.more}
      </Link>
    </article>
  );
}
