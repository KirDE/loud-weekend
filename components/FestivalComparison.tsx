"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import { festivalDateInterval, formatFestivalDateRange } from "@/lib/festival-dates";
import { compareFestivalLineups } from "@/lib/festival-comparison";
import { distanceKm, type Coordinates } from "@/lib/festival-discovery";
import { shareableFavoriteSlugs } from "@/lib/discovery-share";
import { ticketPresentation } from "@/lib/tickets";
import { useLanguage } from "./LanguageProvider";

export function FestivalComparison({
  festivals,
  origin,
  originLabel,
  lineups,
  favorites,
}: {
  festivals: Festival[];
  origin: Coordinates;
  originLabel: string;
  lineups?: DiscoveryLineups;
  favorites: readonly string[];
}) {
  const { t, locale } = useLanguage();
  const { pairs, sharedAcrossAll } = compareFestivalLineups(festivals, lineups);
  const favoriteSlugs = new Set(shareableFavoriteSlugs(favorites, lineups));

  const artistNames = (slugs: string[]) =>
    slugs
      .map((slug) => lineups?.artistNamesBySlug?.[slug])
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b, locale))
      .join(", ");
  const overlap = (slugs: string[] | null) =>
    slugs === null ? (
      t("comparisonLineupUnknown")
    ) : slugs.length === 0 ? (
      t("noLineupOverlap")
    ) : (
      <>
        <strong>{t("sharedActs", { count: slugs.length })}</strong>
        <br />
        {artistNames(slugs)}
      </>
    );

  return (
    <div className="comparisonScroll" tabIndex={0} role="region" aria-label={t("compare")}>
      <table className="comparisonTable">
        <thead>
          <tr>
            <th scope="col">{t("planningDetail")}</th>
            {festivals.map((item) => (
              <th scope="col" key={item.slug}>
                <Link href={`/festivals/${item.slug}/`}>{item.name}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{t("dates")}</th>
            {festivals.map((item) => (
              <td key={item.slug}>{formatFestivalDateRange(item, locale, t("datesTba"))}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t("comparisonDuration")}</th>
            {festivals.map((item) => {
              const dates = festivalDateInterval(item);
              const days = dates
                ? (dates.end.valueOf() - dates.start.valueOf()) / 86_400_000 + 1
                : null;
              return (
                <td key={item.slug}>
                  {days === null ? t("comparisonUnknown") : days.toLocaleString(locale)}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">{t("genres")}</th>
            {festivals.map((item) => (
              <td key={item.slug}>{item.genres.join(", ") || t("comparisonUnknown")}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t("locationDistance", { origin: originLabel })}</th>
            {festivals.map((item) => (
              <td key={item.slug}>
                {item.city || item.country} ·{" "}
                {item.coordinates
                  ? `${distanceKm(origin, item.coordinates).toLocaleString(locale)} km`
                  : t("distanceUnavailable")}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t("tickets")}</th>
            {festivals.map((item) => {
              const ticket = ticketPresentation(item);
              return (
                <td key={item.slug}>
                  {ticket.href ? (
                    <a href={ticket.href} rel="noreferrer" target="_blank">
                      {t(ticket.label)}
                    </a>
                  ) : (
                    t(ticket.label)
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th scope="row">{t("comparisonCamping")}</th>
            {festivals.map((item) => (
              <td key={item.slug}>{t("comparisonUnknown")}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t("comparisonTransport")}</th>
            {festivals.map((item) => (
              <td key={item.slug}>{t("comparisonUnknown")}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t("comparisonFavorites")}</th>
            {festivals.map((item) => {
              const roster = lineups?.artistSlugsByFestival[item.slug] ?? [];
              const matching = [...new Set(roster)].filter((slug) => favoriteSlugs.has(slug));
              return (
                <td key={item.slug}>
                  {roster.length === 0
                    ? t("comparisonLineupUnknown")
                    : artistNames(matching) || t("comparisonNoFavorites")}
                </td>
              );
            })}
          </tr>
        </tbody>
        <tbody>
          {pairs.map((pair) => (
            <tr key={pair.festivals.map((item) => item.slug).join(":")}>
              <th scope="row">{pair.festivals.map((item) => item.name).join(" / ")}</th>
              <td colSpan={festivals.length}>{overlap(pair.shared)}</td>
            </tr>
          ))}
          {festivals.length === 3 && (
            <tr>
              <th scope="row">{t("comparisonAllThree")}</th>
              <td colSpan={festivals.length}>{overlap(sharedAcrossAll)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
