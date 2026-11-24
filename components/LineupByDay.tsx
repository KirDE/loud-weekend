"use client";

import { useState } from "react";
import Link from "next/link";
import type { LineupDayAppearance } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

export function LineupByDay({ appearances }: { appearances: LineupDayAppearance[] }) {
  const { locale, t } = useLanguage();
  const [selection, setSelection] = useState("");
  const dates = [...new Set(appearances.flatMap((appearance) => appearance.dates))].sort();
  const activeDay = dates.includes(selection) || selection === "unassigned" ? selection : "";
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  const label = (date: string) =>
    date === "unassigned" ? t("lineupDayUnassigned") : format.format(new Date(`${date}T00:00:00Z`));

  const groups = [...dates, "unassigned"]
    .filter((date) => !activeDay || date === activeDay)
    .map((date) => ({
      date,
      artists: appearances.filter(({ dates }) =>
        date === "unassigned" ? !dates.length : dates.includes(date),
      ),
    }));

  return (
    <section aria-labelledby="lineup-days-heading">
      <h3 id="lineup-days-heading">{t("lineupByDay")}</h3>
      <p>{t("lineupDayHelp")}</p>
      <label className="lineupSort">
        {t("lineupDayFilter")}
        <select value={activeDay} onChange={(event) => setSelection(event.target.value)}>
          <option value="">{t("lineupDayAll")}</option>
          {[...dates, "unassigned"].map((date) => (
            <option value={date} key={date}>
              {label(date)}
            </option>
          ))}
        </select>
      </label>
      {groups.map(({ date, artists }) => (
        <section key={date}>
          <h4>{label(date)}</h4>
          {artists.length ? (
            <ul>
              {artists.map(({ artist, artistSlug, cancelled, sourceUrl }) => (
                <li key={artistSlug}>
                  <Link href={`/artists/${artistSlug}/`}>{artist}</Link>
                  {cancelled && <> — {t("lineupDayCancelled")}</>}
                  {sourceUrl && (
                    <>
                      {" "}
                      · <a href={sourceUrl}>{t("primarySource")}</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("lineupDayNone")}</p>
          )}
        </section>
      ))}
    </section>
  );
}
