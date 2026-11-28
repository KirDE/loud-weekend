"use client";

import Link from "./CatalogLink";
import type { AnnouncementFilters, readPublicAnnouncements } from "@/lib/catalog/public-history";
import { publicHistoryCopy } from "@/lib/catalog/public-history-copy";
import { useLanguage } from "./LanguageProvider";

export function AnnouncementsTimeline({
  filters,
  entries,
  countries,
  hasNext,
}: { filters: AnnouncementFilters } & Awaited<ReturnType<typeof readPublicAnnouncements>>) {
  const { language } = useLanguage();
  const copy = publicHistoryCopy[language];
  const path = `/${language}/announcements/`;
  const displayRegion = new Intl.DisplayNames([language], { type: "region" });
  const dateFormat = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const choices = countries
    .filter(({ countryCode }) => /^[A-Z]{2}$/.test(countryCode))
    .map(({ countryCode, country }) => ({
      code: countryCode,
      label: displayRegion.of(countryCode) ?? country,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
  const pageUrl = (page: number, artist = filters.artist) => {
    const query = new URLSearchParams();
    if (artist) query.set("artist", artist);
    if (filters.country) query.set("country", filters.country);
    if (filters.days) query.set("period", String(filters.days));
    if (page > 1) query.set("page", String(page));
    return query.size ? `${path}?${query}` : path;
  };

  return (
    <div className="detailPage editionHistory">
      <h1>{copy.timeline}</h1>
      <p>{copy.intro}</p>
      {filters.artist && <Link href={pageUrl(1, "")}>{copy.clearArtist}</Link>}
      <form
        method="get"
        action={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${path}`}
        className="lineupSort"
      >
        {filters.artist && <input type="hidden" name="artist" value={filters.artist} />}
        <label>
          {copy.country}{" "}
          <select name="country" defaultValue={filters.country}>
            <option value="">{copy.everyCountry}</option>
            {filters.country && !choices.some(({ code }) => code === filters.country) && (
              <option value={filters.country}>{filters.country}</option>
            )}
            {choices.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {copy.period}{" "}
          <select name="period" defaultValue={filters.days ?? ""}>
            <option value="">{copy.allTime}</option>
            <option value="30">{copy.days30}</option>
            <option value="90">{copy.days90}</option>
          </select>
        </label>
        <button type="submit" className="outlineButton">
          {copy.apply}
        </button>
      </form>
      {entries.length ? (
        <ol>
          {entries.map(({ slug, year, name, officialUrl, publishedAt, categories }, index) => (
            <li key={`${slug}:${year}:${publishedAt}:${index}`}>
              <Link href={`/festivals/${encodeURIComponent(slug)}/${year}/`}>
                {name} {year}
              </Link>
              <time dateTime={publishedAt}>{dateFormat.format(new Date(publishedAt))} UTC</time>
              <p>{categories.map((category) => copy[category]).join(" · ")}</p>
              <a href={officialUrl} rel="noreferrer">
                {copy.official}
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p>{copy.noResults}</p>
      )}
      <nav aria-label={copy.timeline} className="lineupSort">
        {filters.page > 1 && (
          <Link href={pageUrl(filters.page - 1)} rel="prev">
            {copy.previous}
          </Link>
        )}
        {hasNext && (
          <Link href={pageUrl(filters.page + 1)} rel="next">
            {copy.next}
          </Link>
        )}
      </nav>
    </div>
  );
}
