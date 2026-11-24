"use client";

import { sendProductEvent } from "@/lib/product-events";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import { formatFreshnessDate } from "@/lib/freshness-date";
import type { Festival } from "@/lib/domain/festival";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import {
  discoverySorts,
  sortDiscoveryFestivals,
  type DiscoveryLineups,
  type DiscoverySort,
} from "@/lib/discovery-sort";
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
  defaultDiscoveryPreferences,
  discoveryDistances,
  discoveryOrigins as origins,
  type DiscoveryPreferences,
} from "@/lib/discovery-preferences";

export function FestivalExplorer({
  festivals,
  freshness,
  discoveryLineups,
}: {
  festivals: Festival[];
  freshness?: CatalogFreshness;
  discoveryLineups?: DiscoveryLineups;
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
  const activeFilters = shared
    ? { ...shared.filters, ...(draft?.key === linkKey ? draft.patch : {}) }
    : planner.savedFilters;
  const { query, country, announcedOnly, month, ticketsOnly, genre, origin, maxDistance, sort } =
    activeFilters;
  const linkedDates = useMemo(
    () => (queryParams ? datesFromQuery(queryParams) : null),
    [queryParams],
  );
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
  const originCoordinates = origins[origin].coordinates;
  const filtered = useMemo(
    () =>
      festivals.filter((item) => {
        const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup]
          .join(" ")
          .toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (country === "all" || item.countryCode === country) &&
          (!announcedOnly || hasAnnouncedLineup(item)) &&
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
  const visible = useMemo(
    () =>
      sortDiscoveryFestivals(filtered, sort, {
        locale,
        origin: originCoordinates,
        favorites: favoriteKeys,
        lineups: discoveryLineups,
      }),
    [filtered, sort, locale, originCoordinates, favoriteKeys, discoveryLineups],
  );
  const compared = festivals.filter((item) => selected.includes(item.slug));
  const toggleSelected = (item: Festival) => {
    if (!selected.includes(item.slug) && selected.length < 3) sendProductEvent("COMPARE", language);
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
  };

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
        <div className="search" data-ready={filtersReady}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            aria-label={t("filterSearch")}
            value={query}
            onChange={(event) => updateFilters({ query: event.target.value })}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.repeat &&
                !event.nativeEvent.isComposing &&
                query.trim()
              )
                sendProductEvent("SEARCH_SUBMIT", language);
            }}
            placeholder={t("search")}
          />
          {query && (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onClick={() => {
                updateFilters({ query: "" });
                searchRef.current?.focus();
              }}
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
        <select
          aria-label={t("countries")}
          value={country}
          onChange={(event) => {
            updateFilters({ country: event.target.value });
            sendProductEvent("FILTER_USED", language);
          }}
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
          onChange={(event) => {
            updateFilters({ month: event.target.value });
            sendProductEvent("FILTER_USED", language);
          }}
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
          onChange={(event) => {
            updateFilters({ genre: event.target.value });
            sendProductEvent("FILTER_USED", language);
          }}
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
          value={origin}
          onChange={(event) => {
            updateFilters({ origin: event.target.value as DiscoveryPreferences["origin"] });
            sendProductEvent("FILTER_USED", language);
          }}
        >
          {Object.entries(origins).map(([value, item]) => (
            <option key={value} value={value}>
              {t("fromOrigin", { origin: item.label })}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterDistance")}
          value={maxDistance}
          onChange={(event) => {
            updateFilters({ maxDistance: event.target.value });
            sendProductEvent("FILTER_USED", language);
          }}
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
        <DiscoveryShare filters={{ ...activeFilters, ...dateFilters }} favorites={shareFavorites} />
        <DiscoveryDateFilters filters={dateFilters} onChange={updateDates} />
        <div className="filterToggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={announcedOnly}
              onChange={(event) => {
                updateFilters({ announcedOnly: event.target.checked });
                sendProductEvent("FILTER_USED", language);
              }}
            />
            <span />
            {t("onlyAnnouncedActs")}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ticketsOnly}
              onChange={(event) => {
                updateFilters({ ticketsOnly: event.target.checked });
                sendProductEvent("FILTER_USED", language);
              }}
            />
            <span aria-hidden="true" />
            {t("officialTicketsOnly")}
          </label>
        </div>
      </div>
      <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
        {comparisonStatus}
      </p>
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
              originLabel={origins[origin].label}
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
      <div className="festivalGrid">
        {visible.map((item) => {
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
                <div className="cardTop">
                  <FestivalLogo slug={item.slug} name={item.name} />
                  <span className={`status ${lineupStatus.tone}`}>{t(lineupStatus.label)}</span>
                </div>
                {item.sourceDeprecated && (
                  <span className="status deprecated">{t("sourceDeprecated")}</span>
                )}
                <div className="date">{formatFestivalDateRange(item, locale, t("datesTba"))}</div>
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
                    {artistCount ? `${artistCount} ${t("announcedActs")}` : t("followUpdates")}
                  </span>
                  <b>{t("explore")} →</b>
                </div>
              </Link>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty">
          <strong>{t("noMatches")}</strong>
          <p>{t(dateFiltersActive ? "noDateMatches" : "noDiscoveryMatches")}</p>
        </div>
      )}
    </section>
  );
}
