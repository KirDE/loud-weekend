"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import { formatFreshnessDate } from "@/lib/freshness-date";
import type { Festival } from "@/lib/domain/festival";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { editionOnHiatus } from "@/lib/edition-lifecycle";
import {
  discoverySorts,
  sortDiscoveryFestivals,
  type DiscoveryLineups,
  type DiscoverySort,
} from "@/lib/discovery-sort";
import { OriginSearch } from "./OriginSearch";
import { DiscoveryShare } from "./DiscoveryShare";
import {
  discoveryFromQuery,
  removeDiscoveryQuery,
  shareableFavoriteSlugs,
} from "@/lib/discovery-share";
import { DiscoveryDateFilters } from "./DiscoveryDateFilters";
import {
  datesFromQuery,
  hasDiscoveryDates,
  matchesDiscoveryDates,
  removeDateQuery,
  type DiscoveryDates,
} from "@/lib/discovery-dates";
import { FestivalComparison } from "./FestivalComparison";
import { useLocalPlanner } from "./LocalPlanner";
import { hasAvailableTickets } from "@/lib/tickets";
import { festivalGenres, festivalMatchesDiscoveryFilters } from "@/lib/festival-discovery";
import {
  availableFestivalMonths,
  festivalOverlapsMonth,
  formatFestivalDateRange,
} from "@/lib/festival-dates";
import {
  announcedArtists,
  hasAnnouncedLineup,
  lineupPresentation,
  lineupPreviewArtists,
} from "@/lib/festival-lineup";

import {
  festivalArtistMatch,
  matchesArtistMode,
  type DiscoveryArtist,
} from "@/lib/discovery-artists";
import { DiscoveryArtistPicker } from "./DiscoveryArtistPicker";
import { DiscoverySearch } from "./DiscoverySearch";
import type { SuggestionArtist } from "@/lib/discovery-suggestions";
import {
  defaultDiscoveryPreferences,
  discoveryDistances,
  discoveryOrigins as origins,
  type DiscoveryPreferences,
} from "@/lib/discovery-preferences";

const RESULT_BATCH_SIZE = 48;

const emptyArtistSelection: string[] = [];

export function FestivalExplorer({
  festivals,
  freshness,
  discoveryLineups,
  matchingArtists,
  suggestionArtists,
}: {
  festivals: Festival[];
  freshness?: CatalogFreshness;
  discoveryLineups?: DiscoveryLineups;
  matchingArtists?: readonly DiscoveryArtist[];
  suggestionArtists?: readonly SuggestionArtist[];
}) {
  const { language, locale, t } = useLanguage();
  const planner = useLocalPlanner();
  const filtersReady = planner.ready;
  const queryParams = useSearchParams();
  const linkKey = queryParams?.toString() ?? "";
  const shared = useMemo(
    () => (queryParams ? discoveryFromQuery(queryParams, discoveryLineups) : null),
    [queryParams, discoveryLineups],
  );
  const [draft, setDraft] = useState<{ key: string; patch: Partial<DiscoveryPreferences> }>();
  // Leaving a shared URL discards its temporary edits. Browser history
  // restores the URL's own snapshot, not edits that were never in that URL.
  if (draft && draft.key !== linkKey) setDraft(undefined);
  const activeFilters = useMemo(
    () =>
      shared
        ? { ...shared.filters, ...(draft?.key === linkKey ? draft.patch : {}) }
        : planner.savedFilters,
    [shared, draft, linkKey, planner.savedFilters],
  );
  const {
    query,
    country,
    announcedOnly,
    month,
    ticketsOnly,
    genre,
    origin,
    customOrigin,
    maxDistance,
    sort,
  } = activeFilters;
  const linkedDates = useMemo(
    () => (queryParams ? datesFromQuery(queryParams) : null),
    [queryParams],
  );
  const artistSelection = matchingArtists
    ? (activeFilters.artistSelection ?? emptyArtistSelection)
    : emptyArtistSelection;
  const artistMatch = activeFilters.artistMatch ?? "all";
  const dateFilters = shared ? activeFilters : (linkedDates ?? activeFilters);
  const dateFiltersActive = hasDiscoveryDates(dateFilters);
  const favoriteKeys = shared?.favorites ?? planner.favoriteArtists;
  const shareFavorites = useMemo(
    () => shareableFavoriteSlugs(favoriteKeys, discoveryLineups),
    [favoriteKeys, discoveryLineups],
  );
  const updateFilters = (patch: Partial<DiscoveryPreferences>) => {
    if (!shared) {
      planner.updateSavedFilters(patch);
      return;
    }
    setDraft((current) => ({
      key: linkKey,
      patch: { ...(current?.key === linkKey ? current.patch : {}), ...patch },
    }));
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const nextFocusIndex = useRef<number | null>(null);
  const [expanded, setExpanded] = useState<{ results: Festival[]; limit: number }>();
  const showMore = {
    en: "Show more festivals",
    de: "Mehr Festivals anzeigen",
    ru: "Показать ещё фестивали",
  }[language];
  const [selected, setSelected] = useState<string[]>([]);
  const [comparisonStatus, setComparisonStatus] = useState("");
  const displayNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const countries = useMemo(
    () =>
      Array.from(
        new Set([
          ...festivals.map((item) => item.countryCode),
          ...(country === "all" ? [] : [country]),
        ]),
      ).sort((a, b) => (displayNames.of(a) || a).localeCompare(displayNames.of(b) || b, locale)),
    [festivals, country, displayNames, locale],
  );
  const months = useMemo(() => {
    const available = availableFestivalMonths(festivals);
    // Keep a restored choice visible on country/month subsets with no matching
    // event, so the controlled select never disguises an active month filter.
    return /^(0[1-9]|1[0-2])$/.test(month)
      ? [...new Set([...available, Number(month)])].sort((a, b) => a - b)
      : available;
  }, [festivals, month]);
  const genres = useMemo(() => {
    const available = festivalGenres(festivals);
    return genre === "all" || available.includes(genre) ? available : [...available, genre].sort();
  }, [festivals, genre]);
  const originCoordinates = customOrigin ?? origins[origin].coordinates;
  const originLabel = customOrigin
    ? `${customOrigin.name}, ${displayNames.of(customOrigin.countryCode)}`
    : origins[origin].label;
  const filtered = useMemo(
    () =>
      festivals.filter((item) => {
        const haystack = [item.name, item.country, item.city, ...announcedArtists(item)]
          .join(" ")
          .toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (country === "all" || item.countryCode === country) &&
          (!announcedOnly || (!editionOnHiatus(item) && hasAnnouncedLineup(item))) &&
          (month === "all" || festivalOverlapsMonth(item, Number(month))) &&
          (!ticketsOnly || hasAvailableTickets(item)) &&
          matchesDiscoveryDates(item, dateFilters) &&
          festivalMatchesDiscoveryFilters(item, {
            genre: genre === "all" ? undefined : genre,
            origin: originCoordinates,
            maxDistanceKm: maxDistance === "all" ? undefined : Number(maxDistance),
          })
        );
      }),
    [
      festivals,
      query,
      country,
      announcedOnly,
      month,
      ticketsOnly,
      genre,
      originCoordinates,
      maxDistance,
      dateFilters,
    ],
  );
  const artistMatches = useMemo(
    () =>
      new Map(
        filtered.map((festival) => [
          festival.slug,
          festivalArtistMatch(festival, artistSelection, discoveryLineups),
        ]),
      ),
    [filtered, artistSelection, discoveryLineups],
  );
  const withoutRoster =
    artistSelection.length > 0
      ? [...artistMatches.values()].filter((match) => !match.known).length
      : 0;
  const artistNames = useMemo(
    () => new Map(matchingArtists?.map(({ slug, name }) => [slug, name])),
    [matchingArtists],
  );
  const visible = useMemo(() => {
    const candidates = filtered.filter((festival) =>
      matchesArtistMode(artistMatches.get(festival.slug)!, artistSelection.length, artistMatch),
    );
    return sortDiscoveryFestivals(candidates, sort, {
      locale,
      origin: originCoordinates,
      favorites: favoriteKeys,
      lineups: discoveryLineups,
    }).sort(
      (a, b) =>
        artistMatches.get(b.slug)!.matched.length - artistMatches.get(a.slug)!.matched.length,
    );
  }, [
    filtered,
    artistMatches,
    artistSelection.length,
    artistMatch,
    sort,
    locale,
    originCoordinates,
    favoriteKeys,
    discoveryLineups,
  ]);
  const cardLimit = expanded?.results === visible ? expanded.limit : RESULT_BATCH_SIZE;
  const shownCount = Math.min(cardLimit, visible.length);
  const moreCount = Math.min(RESULT_BATCH_SIZE, visible.length - shownCount);
  useEffect(() => {
    if (nextFocusIndex.current === null) return;
    gridRef.current?.children[nextFocusIndex.current]
      ?.querySelector<HTMLAnchorElement>("a")
      ?.focus();
    nextFocusIndex.current = null;
  }, [cardLimit]);
  const revealNextResults = () => {
    nextFocusIndex.current = shownCount;
    setExpanded({ results: visible, limit: shownCount + moreCount });
  };
  const compared = festivals.filter((item) => selected.includes(item.slug));
  const toggleSelected = (item: Festival) =>
    setSelected((current) => {
      if (current.includes(item.slug)) {
        const next = current.filter((value) => value !== item.slug);
        setComparisonStatus(t("comparisonRemoved", { festival: item.name, count: next.length }));
        return next;
      }
      if (current.length >= 3) {
        setComparisonStatus(t("comparisonLimit", { festival: item.name }));
        return current;
      }
      const next = [...current, item.slug];
      setComparisonStatus(t("comparisonSelected", { festival: item.name, count: next.length }));
      return next;
    });
  const clearLinkedDates = () => {
    const url = new URL(window.location.href);
    removeDateQuery(url);
    window.history.replaceState(null, "", url);
  };
  const updateDates = (patch: Partial<DiscoveryDates>) => {
    updateFilters(shared ? patch : { ...linkedDates, ...patch });
    if (!shared && linkedDates) clearLinkedDates();
  };
  const clearFilters = () => {
    if (shared) {
      const url = new URL(window.location.href);
      removeDiscoveryQuery(url);
      setDraft(undefined);
      window.history.pushState(null, "", url);
    } else {
      if (linkedDates) clearLinkedDates();
      planner.setSavedFilters(defaultDiscoveryPreferences);
    }
    searchRef.current?.focus();
  };

  return (
    <section className="explorer">
      <div className="filterBar">
        <DiscoverySearch
          query={query}
          ready={filtersReady}
          festivals={festivals}
          artists={suggestionArtists}
          inputRef={searchRef}
          onChange={(query) => updateFilters({ query })}
        />
        <select
          aria-label={t("countries")}
          value={country}
          onChange={(event) => updateFilters({ country: event.target.value })}
        >
          <option value="all">{t("allCountries")}</option>
          {countries.map((value) => (
            <option value={value} key={value}>
              {displayNames.of(value) || value}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterMonth")}
          value={month}
          onChange={(event) => updateFilters({ month: event.target.value })}
        >
          <option value="all">{t("allMonths")}</option>
          {months.map((value) => (
            <option key={value} value={String(value).padStart(2, "0")}>
              {new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
                new Date(Date.UTC(2027, value - 1, 1)),
              )}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterGenre")}
          value={genre}
          onChange={(event) => updateFilters({ genre: event.target.value })}
        >
          <option value="all">{t("allGenres")}</option>
          {genres.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterOrigin")}
          value={customOrigin ? "custom" : origin}
          onChange={(event) => {
            if (event.target.value !== "custom")
              updateFilters({
                origin: event.target.value as DiscoveryPreferences["origin"],
                customOrigin: undefined,
              });
          }}
        >
          {customOrigin && (
            <option value="custom">{t("fromOrigin", { origin: originLabel })}</option>
          )}
          {Object.entries(origins).map(([value, item]) => (
            <option key={value} value={value}>
              {t("fromOrigin", { origin: item.label })}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterDistance")}
          value={maxDistance}
          onChange={(event) => updateFilters({ maxDistance: event.target.value })}
        >
          <option value="all">{t("anyDistance")}</option>
          {discoveryDistances.map((value) => (
            <option key={value} value={value}>
              {t("withinDistance", { distance: Number(value).toLocaleString(locale) })}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="outlineButton clearFilters"
          onClick={clearFilters}
          disabled={!filtersReady}
        >
          {t("clearAllFilters")}
        </button>
        <DiscoveryDateFilters filters={dateFilters} onChange={updateDates} />
        {matchingArtists && (
          <DiscoveryArtistPicker
            artists={matchingArtists}
            selected={artistSelection}
            mode={artistMatch}
            favorites={new Set(shareableFavoriteSlugs(planner.favoriteArtists, discoveryLineups))}
            onChange={(artistSelection, artistMatch) =>
              updateFilters({ artistSelection, artistMatch })
            }
          />
        )}
        <DiscoveryShare
          filters={{ ...activeFilters, ...dateFilters, artistSelection }}
          favorites={shareFavorites}
        />
        <div className="filterToggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={announcedOnly}
              onChange={(event) => updateFilters({ announcedOnly: event.target.checked })}
            />
            <span />
            {t("onlyAnnouncedActs")}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ticketsOnly}
              onChange={(event) => updateFilters({ ticketsOnly: event.target.checked })}
            />
            <span aria-hidden="true" />
            {t("officialTicketsOnly")}
          </label>
        </div>
      </div>
      <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
        {comparisonStatus}
      </p>
      <OriginSearch onPick={(customOrigin) => updateFilters({ customOrigin })} />
      {compared.length > 0 && (
        <div className="compareTray">
          <div className="compareHeading">
            <strong>
              {t("compare")} ({compared.length}/3)
            </strong>
            {compared.map((item) => (
              <button
                aria-label={t("removeFestivalComparison", { festival: item.name })}
                onClick={() => toggleSelected(item)}
                key={item.slug}
              >
                {item.name} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          {compared.length < 2 ? (
            <p className="compareHint">{t("comparisonInstructions")}</p>
          ) : (
            <FestivalComparison
              festivals={compared}
              origin={originCoordinates}
              originLabel={originLabel}
              lineups={discoveryLineups}
              favorites={favoriteKeys}
            />
          )}
        </div>
      )}
      <div className="discoveryOrder">
        <label>
          {t("discoverySort")}{" "}
          <select
            value={sort}
            disabled={!filtersReady}
            onChange={(event) => updateFilters({ sort: event.target.value as DiscoverySort })}
          >
            {discoverySorts.map((value) => (
              <option key={value} value={value}>
                {t(`discoverySort_${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="resultMeta">
        <span>
          {shownCount < visible.length && `${shownCount} / `}
          {visible.length} {t("festivals")}
        </span>
        {freshness && (
          <span>
            {freshness.checkedAt ? (
              <>
                {t("latestSourceCheck")} ·{" "}
                <time dateTime={freshness.checkedAt}>
                  {formatFreshnessDate(freshness.checkedAt, locale)}
                </time>
              </>
            ) : (
              t("sourceCheckUnavailable")
            )}
            {freshness.lastPublishedAt && (
              <>
                {" "}
                · {t("latestCatalogPublication")} ·{" "}
                <time dateTime={freshness.lastPublishedAt}>
                  {formatFreshnessDate(freshness.lastPublishedAt, locale)}
                </time>
              </>
            )}
          </span>
        )}
      </div>
      {withoutRoster > 0 && (
        <p className="compareHint">{t("artistMatchesUnknown", { count: withoutRoster })}</p>
      )}
      <div className="festivalGrid" ref={gridRef}>
        {visible.slice(0, shownCount).map((item) => {
          const hiatus = editionOnHiatus(item);
          const isSelected = selected.includes(item.slug);
          const previewArtists = lineupPreviewArtists(item);
          const artistCount = announcedArtists(item).length;
          const lineupStatus = lineupPresentation(item);
          return (
            <article className="festivalCard" key={item.slug}>
              <button
                type="button"
                className={`compareButton ${isSelected ? "active" : ""}`}
                aria-pressed={isSelected}
                aria-label={t("compareFestival", { festival: item.name })}
                onClick={() => toggleSelected(item)}
                disabled={!isSelected && selected.length >= 3}
              >
                <span aria-hidden="true">{isSelected ? "✓ " : "+ "}</span>
                {t("compare")}
              </button>
              <Link href={`/festivals/${item.slug}/`}>
                {artistSelection.length > 0 && (
                  <p className="artistMatchSummary">
                    {t("artistMatchSummary", {
                      count: artistMatches.get(item.slug)!.matched.length,
                    })}
                    :{" "}
                    {artistMatches
                      .get(item.slug)!
                      .matched.map((slug) => artistNames.get(slug) ?? slug)
                      .join(", ")}
                  </p>
                )}
                <div className="cardTop">
                  <FestivalLogo slug={item.slug} name={item.name} />
                  <span className={`status ${hiatus ? "hiatus" : lineupStatus.tone}`}>
                    {t(hiatus ? "editionHiatus" : lineupStatus.label)}
                  </span>
                </div>
                {item.sourceDeprecated && (
                  <span className="status deprecated">{t("sourceDeprecated")}</span>
                )}
                <div className="date">
                  {formatFestivalDateRange(item, locale, t("datesTba"), t("editionHiatus"))}
                </div>
                <h2>{item.name}</h2>
                <div className="location">
                  {item.countryCode} ·{" "}
                  {item.city || displayNames.of(item.countryCode) || item.country}
                </div>
                <div className="artists">
                  {previewArtists.length
                    ? previewArtists.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>)
                    : null}
                </div>
                <div className="cardFoot">
                  <span>
                    {hiatus
                      ? t("editionHiatus")
                      : artistCount
                        ? `${artistCount} ${t("announcedActs")}`
                        : t("followUpdates")}
                  </span>
                  <b>{t("explore")} →</b>
                </div>
              </Link>
            </article>
          );
        })}
      </div>
      {moreCount > 0 && (
        <div className="moreFestivalResults">
          <button type="button" className="outlineButton" onClick={revealNextResults}>
            {showMore} ({moreCount})
          </button>
        </div>
      )}
      {!visible.length && (
        <div className="empty">
          <strong>{t("noMatches")}</strong>
          <p>{t(dateFiltersActive ? "noDateMatches" : "noDiscoveryMatches")}</p>
        </div>
      )}
    </section>
  );
}
