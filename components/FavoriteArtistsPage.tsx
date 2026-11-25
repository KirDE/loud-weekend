"use client";

import Link from "next/link";
import { useState } from "react";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { Festival } from "@/lib/domain/festival";
import { favoriteArtistSlug } from "@/lib/favorite-artists";
import { ArtistFavoriteButton, useLocalPlanner } from "./LocalPlanner";
import { useLanguage } from "./LanguageProvider";

type Artist = { slug: string; name: string };
type Appearance = Pick<
  Festival,
  "slug" | "name" | "countryCode" | "editionYear" | "startDate" | "endDate"
>;

const labels = {
  en: {
    title: "My artists",
    plan: "Back to my plan",
    heading: "Current festival appearances",
    search: "Find an artist to save",
    noMatches: "No matching artists.",
    empty: "No favorite artists yet.",
    noShows: "No current appearances in the catalogue.",
    unavailable: "Saved artist not currently listed",
    remove: "Remove",
    dates: "Dates TBA",
  },
  de: {
    title: "Meine Künstler",
    plan: "Zurück zu meinem Plan",
    heading: "Aktuelle Festivalauftritte",
    search: "Künstler zum Speichern suchen",
    noMatches: "Keine passenden Künstler.",
    empty: "Noch keine Lieblingskünstler gespeichert.",
    noShows: "Keine aktuellen Auftritte im Katalog.",
    unavailable: "Gespeicherter Künstler derzeit nicht im Katalog",
    remove: "Entfernen",
    dates: "Termine offen",
  },
  ru: {
    title: "Мои артисты",
    plan: "Назад к моему плану",
    heading: "Актуальные выступления на фестивалях",
    search: "Найти артиста для сохранения",
    noMatches: "Нет подходящих артистов.",
    empty: "Любимых артистов пока нет.",
    noShows: "В каталоге нет актуальных выступлений.",
    unavailable: "Сохранённого артиста сейчас нет в каталоге",
    remove: "Удалить",
    dates: "Даты уточняются",
  },
};

export function FavoriteArtistsPage({
  artists,
  festivals,
  lineups,
}: {
  artists: Artist[];
  festivals: Appearance[];
  lineups: DiscoveryLineups;
}) {
  const { language, locale } = useLanguage();
  const copy = labels[language];
  const planner = useLocalPlanner();
  const [query, setQuery] = useState("");
  const bySlug = new Map(artists.map((artist) => [artist.slug, artist]));
  const saved = new Map<string, Artist>();
  const unavailable: string[] = [];
  for (const key of planner.favoriteArtists) {
    const artist = bySlug.get(favoriteArtistSlug(key, lineups.legacyFavoriteSlugs) ?? "");
    if (artist) saved.set(artist.slug, artist);
    else unavailable.push(key);
  }

  const term = query.trim().toLocaleLowerCase(locale);
  const aliasMatches = new Set<string>();
  if (term) {
    for (const [name, slug] of Object.entries(lineups.legacyFavoriteSlugs)) {
      if (name.toLocaleLowerCase(locale).includes(term)) aliasMatches.add(slug);
    }
  }
  const matches = term
    ? artists
        .filter(
          (artist) =>
            artist.name.toLocaleLowerCase(locale).includes(term) || aliasMatches.has(artist.slug),
        )
        .slice(0, 12)
    : [];
  const byDate = [...festivals].sort(
    (a, b) =>
      (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") ||
      a.name.localeCompare(b.name, locale),
  );
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const countries = new Intl.DisplayNames(locale, { type: "region" });
  const dateLabel = ({ startDate, endDate }: Appearance) => {
    if (!startDate) return copy.dates;
    const start = new Date(startDate);
    return endDate && endDate > startDate
      ? date.formatRange(start, new Date(endDate))
      : date.format(start);
  };

  const nameCounts = new Map<string, number>();
  for (const { name } of artists) {
    const key = name.toLocaleLowerCase(locale);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const artistLabel = ({ name, slug }: Artist) =>
    (nameCounts.get(name.toLocaleLowerCase(locale)) ?? 0) > 1 ? name + " · " + slug : name;

  function artistLink(artist: Artist) {
    return <Link href={`/${language}/artists/${artist.slug}/`}>{artistLabel(artist)}</Link>;
  }

  return (
    <div className="plannerPage favoriteArtistsPage">
      <div className="plannerHero">
        <div>
          <Link className="back" href={`/${language}/planner/`}>
            {copy.plan}
          </Link>
          <h1>{copy.title}</h1>
        </div>
      </div>
      {planner.ready && (
        <>
          <section className="plannerSection" aria-labelledby="favorite-appearances">
            <h2 id="favorite-appearances">{copy.heading}</h2>
            {saved.size === 0 && unavailable.length === 0 && <p>{copy.empty}</p>}
            <div className="favoriteArtistList">
              {[...saved.values()]
                .sort((a, b) => a.name.localeCompare(b.name, locale))
                .map((artist) => {
                  const appearances = byDate.filter((festival) =>
                    lineups.artistSlugsByFestival[festival.slug]?.includes(artist.slug),
                  );
                  return (
                    <article key={artist.slug}>
                      <div>
                        <h3>{artistLink(artist)}</h3>
                        {appearances.length ? (
                          <ul>
                            {appearances.map((festival) => (
                              <li key={festival.slug}>
                                <Link
                                  href={
                                    festival.editionYear
                                      ? `/festivals/${festival.slug}/${festival.editionYear}/`
                                      : `/${language}/festivals/${festival.slug}/`
                                  }
                                >
                                  {festival.name}
                                  {festival.editionYear ? ` · ${festival.editionYear}` : ""}
                                </Link>
                                <span>
                                  {dateLabel(festival)} ·{" "}
                                  {countries.of(festival.countryCode.toUpperCase())}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{copy.noShows}</p>
                        )}
                      </div>
                      <ArtistFavoriteButton
                        slug={artist.slug}
                        name={artistLabel(artist)}
                        legacySlugs={lineups.legacyFavoriteSlugs}
                      />
                    </article>
                  );
                })}
              {unavailable.map((key) => (
                <article key={key}>
                  <div>
                    <strong>{key.replace(/^artist:/, "")}</strong>
                    <span>{copy.unavailable}</span>
                  </div>
                  <button
                    className="favoriteButton"
                    type="button"
                    onClick={() => planner.removeArtistKey(key)}
                  >
                    {copy.remove}
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="plannerSection" aria-labelledby="favorite-search-label">
            <h2>
              <label id="favorite-search-label" htmlFor="favorite-search">
                {copy.search}
              </label>
            </h2>
            <input
              id="favorite-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p role="status">{term && !matches.length ? copy.noMatches : ""}</p>
            <div className="favoriteArtistList">
              {matches.map((artist) => (
                <article key={artist.slug}>
                  <div>{artistLink(artist)}</div>
                  <ArtistFavoriteButton
                    slug={artist.slug}
                    name={artistLabel(artist)}
                    legacySlugs={lineups.legacyFavoriteSlugs}
                  />
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
