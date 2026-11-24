"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import { formatFreshnessDate } from "@/lib/freshness-date";
import type { Festival } from "@/lib/domain/festival";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { lineupOverlap } from "@/lib/planning";
import { useLocalPlanner } from "./LocalPlanner";
import { hasAvailableTickets, ticketPresentation } from "@/lib/tickets";
import {
  distanceKm,
  festivalGenres,
  festivalMatchesDiscoveryFilters,
} from "@/lib/festival-discovery";
import {
  availableFestivalMonths,
  festivalOverlapsMonth,
  formatFestivalDateRange,
} from "@/lib/festival-dates";
import { announcedArtists, hasAnnouncedLineup, lineupPreviewArtists } from "@/lib/festival-lineup";

import {
  defaultDiscoveryPreferences,
  discoveryDistances,
  discoveryOrigins as origins,
  type DiscoveryPreferences,
} from "@/lib/discovery-preferences";

const RESULT_BATCH_SIZE = 48;

export function FestivalComparisonTicket({ item }: { item: Festival }) {
  const { t } = useLanguage();
  const tickets = ticketPresentation(item);
  return (
    <td data-ticket-status={tickets.status}>
      {tickets.href ? (
        <a href={tickets.href} rel="noreferrer" target="_blank">
          {t(tickets.label)}
        </a>
      ) : (
        t(tickets.label)
      )}
    </td>
  );
}

export function FestivalExplorer({
  festivals,
  freshness,
}: {
  festivals: Festival[];
  freshness?: CatalogFreshness;
}) {
  const { language, locale, t } = useLanguage();
  const planner = useLocalPlanner();
  const { query, country, announcedOnly, month, ticketsOnly, genre, origin, maxDistance } =
    planner.savedFilters;
  const filtersReady = planner.ready;
  const updateFilters = planner.updateSavedFilters;
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
  const originCoordinates = origins[origin].coordinates;
  const visible = useMemo(
    () =>
      festivals
        .filter((item) => {
          const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup]
            .join(" ")
            .toLowerCase();
          return (
            haystack.includes(query.toLowerCase()) &&
            (country === "all" || item.countryCode === country) &&
            (!announcedOnly || hasAnnouncedLineup(item)) &&
            (month === "all" || festivalOverlapsMonth(item, Number(month))) &&
            (!ticketsOnly || hasAvailableTickets(item)) &&
            festivalMatchesDiscoveryFilters(item, {
              genre: genre === "all" ? undefined : genre,
              origin: originCoordinates,
              maxDistanceKm: maxDistance === "all" ? undefined : Number(maxDistance),
            })
          );
        })
        .sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999")),
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
    ],
  );
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
  const overlap = lineupOverlap(compared);
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
  const clearFilters = () => {
    planner.setSavedFilters(defaultDiscoveryPreferences);
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
          value={origin}
          onChange={(event) =>
            updateFilters({ origin: event.target.value as DiscoveryPreferences["origin"] })
          }
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
        <div className="filterToggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={announcedOnly}
              onChange={(event) => updateFilters({ announcedOnly: event.target.checked })}
            />
            <span />
            {t("lineupAnnounced")}
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
            <div className="comparisonScroll" tabIndex={0}>
              <table className="comparisonTable">
                <thead>
                  <tr>
                    <th scope="col">{t("planningDetail")}</th>
                    {compared.map((item) => (
                      <th scope="col" key={item.slug}>
                        <Link href={`/festivals/${item.slug}/`}>{item.name}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{t("dates")}</th>
                    {compared.map((item) => (
                      <td key={item.slug}>
                        {formatFestivalDateRange(item, locale, t("datesTba"))}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">{t("locationDistance", { origin: origins[origin].label })}</th>
                    {compared.map((item) => (
                      <td key={item.slug}>
                        {item.city || item.country}
                        {item.coordinates
                          ? ` · ${distanceKm(originCoordinates, item.coordinates).toLocaleString(locale)} km`
                          : ` · ${t("distanceUnavailable")}`}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">{t("tickets")}</th>
                    {compared.map((item) => (
                      <FestivalComparisonTicket key={item.slug} item={item} />
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">{t("lineupOverlap")}</th>
                    <td colSpan={compared.length}>
                      {overlap.length ? (
                        <>
                          <strong>{t("sharedActs", { count: overlap.length })}</strong>
                          <br />
                          {overlap.join(", ")}
                        </>
                      ) : (
                        t("noLineupOverlap")
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
      <div className="festivalGrid" ref={gridRef}>
        {visible.slice(0, shownCount).map((item) => {
          const isSelected = selected.includes(item.slug);
          const previewArtists = lineupPreviewArtists(item);
          const artistCount = announcedArtists(item).length;
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
                  <span className={`status ${item.status}`}>
                    {t(item.status === "tba" ? "tba" : item.status)}
                  </span>
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
                  {previewArtists.length ? (
                    previewArtists.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>)
                  ) : (
                    <span className="muted">{t("lineupNotAnnounced")}</span>
                  )}
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
          <p>{t("noDiscoveryMatches")}</p>
        </div>
      )}
    </section>
  );
}
