"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogueBrowse as BrowseData } from "@/lib/catalog/browse";
import { useLanguage } from "./LanguageProvider";

const artistPageSize = 24;

export function CatalogueBrowse({ data }: { data: BrowseData }) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(artistPageSize);
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const monthNames = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const countries = data.countries
    .map((code) => ({ code, name: regions.of(code) ?? code }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code, "en"));
  const artists = useMemo(() => {
    const order = new Intl.Collator(locale, { sensitivity: "base" });
    return [...data.artists].sort(
      (a, b) => order.compare(a.name, b.name) || a.slug.localeCompare(b.slug, "en"),
    );
  }, [data.artists, locale]);
  const needle = query.trim().toLocaleLowerCase(locale);
  const matches = artists.filter((artist) =>
    artist.name.toLocaleLowerCase(locale).includes(needle),
  );

  return (
    <div className="directoryPage catalogueBrowse">
      <h1>{t("browseCatalogue")}</h1>
      <div className="catalogueGroups">
        {countries.length > 0 && (
          <section>
            <h2>{t("browseCountries")}</h2>
            <ul>
              {countries.map(({ code, name }) => (
                <li key={code}>
                  <Link href={`/countries/${code.toLowerCase()}/`}>{name}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.months.length > 0 && (
          <section>
            <h2>{t("browseMonths")}</h2>
            <ul>
              {data.months.map((month) => (
                <li key={month}>
                  <Link href={`/months/${String(month).padStart(2, "0")}/`}>
                    {monthNames.format(new Date(Date.UTC(2000, month - 1, 1)))}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.years.length > 0 && (
          <section>
            <h2>{t("browseSeasons")}</h2>
            <ul>
              {data.years.map((year) => (
                <li key={year}>
                  <Link href={`/editions/${year}/`}>{year}</Link>
                </li>
              ))}
              {data.hasArchive && (
                <li>
                  <Link href="/archive/">{t("browseArchive")}</Link>
                </li>
              )}
            </ul>
          </section>
        )}
        <section>
          <h2>{t("browseArtists")}</h2>
          <label className="browseArtistSearch">
            {t("browseArtistSearch")}
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(artistPageSize);
              }}
            />
          </label>
          <p role="status">{matches.length === 0 ? t("browseNoArtists") : ""}</p>
          <ul>
            {matches.slice(0, limit).map(({ name, slug }) => (
              <li key={slug}>
                <Link href={`/artists/${slug}/`} prefetch={false}>
                  {name}
                </Link>
              </li>
            ))}
          </ul>
          {matches.length > limit && (
            <button
              type="button"
              className="outlineButton"
              onClick={() => setLimit((value) => value + artistPageSize)}
            >
              {t("browseMoreArtists")}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
