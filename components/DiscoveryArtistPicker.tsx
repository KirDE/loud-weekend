"use client";

import { useId, useRef, useState } from "react";
import {
  maxSelectedArtists,
  type ArtistMatchMode,
  type DiscoveryArtist,
} from "@/lib/discovery-artists";
import { useLanguage } from "./LanguageProvider";

export function DiscoveryArtistPicker({
  artists,
  selected,
  mode,
  favorites,
  onChange,
}: {
  artists: readonly DiscoveryArtist[];
  selected: readonly string[];
  mode: ArtistMatchMode;
  favorites: ReadonlySet<string>;
  onChange: (selected: string[], mode: ArtistMatchMode) => void;
}) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const search = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLElement>(null);
  const normalized = query.trim().toLocaleLowerCase(locale);
  const selectedSet = new Set(selected);
  const bySlug = new Map(artists.map((artist) => [artist.slug, artist.name]));
  const nameCount = new Map<string, number>();
  for (const { name } of artists) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  const label = (slug: string) => {
    const name = bySlug.get(slug);
    return name ? ((nameCount.get(name) ?? 0) > 1 ? `${name} (${slug})` : name) : slug;
  };
  const suggestions = artists
    .filter(
      (artist) =>
        !selectedSet.has(artist.slug) &&
        (normalized
          ? artist.name.toLocaleLowerCase(locale).includes(normalized)
          : favorites.has(artist.slug)),
    )
    .sort(
      (a, b) =>
        Number(favorites.has(b.slug)) - Number(favorites.has(a.slug)) ||
        a.name.localeCompare(b.name, locale) ||
        a.slug.localeCompare(b.slug, "en"),
    )
    .slice(0, 8);

  return (
    <details
      className="discoveryDates discoveryArtistPicker"
      open={selected.length > 0 || undefined}
    >
      <summary ref={summary}>{t("matchArtists")}</summary>
      {selected.length > 0 && (
        <ul className="discoveryArtistChoices">
          {selected.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                className="outlineButton"
                aria-label={t("removeMatchedArtist", { name: label(slug) })}
                onClick={() => {
                  const next = selected.filter((value) => value !== slug);
                  (next.length ? search.current : summary.current)?.focus();
                  onChange(next, mode);
                }}
              >
                {label(slug)} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        {t("artistMatchMode")}{" "}
        <select
          value={mode}
          onChange={(event) =>
            onChange([...selected], event.target.value === "any" ? "any" : "all")
          }
        >
          <option value="all">{t("matchAllArtists")}</option>
          <option value="any">{t("matchAnyArtist")}</option>
        </select>
      </label>
      <label htmlFor={searchId}>{t("findMatchArtist")}</label>
      <input
        ref={search}
        id={searchId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {selected.length >= maxSelectedArtists ? (
        <p role="status">{t("artistMatchLimit", { count: maxSelectedArtists })}</p>
      ) : suggestions.length > 0 ? (
        <ul className="discoveryArtistChoices">
          {suggestions.map(({ slug }) => (
            <li key={slug}>
              <button
                type="button"
                className="outlineButton"
                onClick={() => {
                  search.current?.focus();
                  onChange([...selected, slug], mode);
                }}
              >
                {label(slug)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        normalized && <p role="status">{t("artistMatchNone")}</p>
      )}
    </details>
  );
}
