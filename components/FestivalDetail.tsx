"use client";

import { sendProductEvent } from "@/lib/product-events";
import { useState } from "react";
import Link from "next/link";
import { CorrectionReportForm } from "./CorrectionReportForm";
import type { Festival } from "@/lib/domain/festival";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { PublicFestivalOverview } from "@/lib/catalog/festival-overviews";
import { FestivalOverview } from "./FestivalOverview";
import { OfflineTripDownload } from "./OfflineTrip";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import type { PublicArrivalFact } from "@/lib/catalog/arrival-facts";
import { FestivalArrival } from "./FestivalArrival";
import { PlanningTools } from "./PlanningTools";
import { PlaylistCoverageLabel } from "./PlaylistCoverageLabel";
import type { PlaylistStatus } from "@/lib/domain/festival";
import { formatFreshnessDate } from "@/lib/freshness-date";
import { ticketPresentation } from "@/lib/tickets";
import { festivalSetlistHistoryUrl } from "@/lib/setlist-history";
import { festivalDateInterval } from "@/lib/festival-dates";
import {
  announcedArtists,
  hasAnnouncedLineup,
  lineupPresentation,
  sortFestivalLineup,
  type LineupSort,
} from "@/lib/festival-lineup";
import { FavoriteButton, useLocalPlanner, type Attendance } from "./LocalPlanner";

export function FestivalDetail({
  item,
  festivals,
  discoveryLineups,
  artistSlugs,
  playlist,
  overview,
  artistPopularity = {},
  arrivalFacts = [],
}: {
  item: Festival;
  festivals: Festival[];
  discoveryLineups?: DiscoveryLineups;
  artistSlugs: Readonly<Record<string, string>>;
  playlist?: PlaylistStatus;
  overview?: PublicFestivalOverview;
  arrivalFacts?: readonly PublicArrivalFact[];
  artistPopularity?: Readonly<Record<string, number | null>>;
}) {
  const { language, locale, t } = useLanguage();
  const [lineupSort, setLineupSort] = useState<LineupSort>("official");
  const sortedLineup = sortFestivalLineup(item, lineupSort, locale, artistPopularity);
  const planner = useLocalPlanner();
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const prettyDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const setlistUrl = festivalSetlistHistoryUrl(item.slug);
  const tickets = ticketPresentation(item);
  const reviewedSpotify = item.reviewedPlaylistLinks?.spotify;
  const reviewedYoutube = item.reviewedPlaylistLinks?.youtube_music;
  const playlistUrl = reviewedSpotify || playlist?.spotifyUrl || item.playlistUrl;
  const youtubePlaylistUrl = reviewedYoutube || playlist?.youtubeMusicUrl;
  const artistCount = announcedArtists(item).length;
  const hasArtists = hasAnnouncedLineup(item);
  const lineupStatus = lineupPresentation(item);
  const dates = festivalDateInterval(item);
  return (
    <div className="detailPage">
      <Link className="back" href="/">
        ← {t("allFestivals")}
      </Link>
      <section className="detailHero">
        <FestivalLogo slug={item.slug} name={item.name} large />
        <div>
          <div className="eyebrow">
            {item.countryCode} · {item.city || displayNames.of(item.countryCode) || item.country}
          </div>
          <h1>{item.name}</h1>
          <p className="detailDate">
            {dates && item.startDate
              ? `${prettyDate(item.startDate)}` +
                `${item.endDate && item.endDate !== item.startDate ? ` — ${prettyDate(item.endDate)}` : ""}`
              : t("datesTba")}
          </p>
          <span className={`status ${lineupStatus.tone}`}>{t(lineupStatus.label)}</span>
          {item.sourceDeprecated && (
            <span className="status deprecated">{t("sourceDeprecated")}</span>
          )}
        </div>
      </section>
      <section className="localActions">
        <FavoriteButton kind="festival" value={item.slug} />
        <select
          aria-label={t("attendanceFor", { festival: item.name })}
          value={planner.attendance[item.slug] || ""}
          onChange={(event) =>
            planner.setAttendance(
              item.slug,
              (event.target.value || undefined) as Attendance | undefined,
            )
          }
        >
          <option value="">{t("setAttendance")}</option>
          <option value="going">{t("going")}</option>
          <option value="maybe">{t("maybe")}</option>
          <option value="not-going">{t("notGoing")}</option>
        </select>
        <Link href="/planner/">{t("openPlan")}</Link>
      </section>
      <div className="actionGrid">
        <a href={item.officialUrl} target="_blank" rel="noreferrer">
          <small>{t("official")}</small>
          <strong>{t("festivalWebsite")}</strong>
        </a>
        {tickets.href ? (
          <a
            href={tickets.href}
            target="_blank"
            rel="noreferrer"
            data-ticket-status={tickets.status}
            onClick={() => sendProductEvent("TICKET_OUTBOUND", language)}
          >
            <small>{t(tickets.status === "available" ? "passes" : tickets.label)}</small>
            <strong>
              {t(
                tickets.status === "available"
                  ? tickets.label
                  : tickets.status === "free"
                    ? "festivalWebsite"
                    : "ticketsInfo",
              )}
            </strong>
          </a>
        ) : (
          <div className="disabled" data-ticket-status={tickets.status}>
            <small>{t("passes")}</small>
            <strong>{t(tickets.label)}</strong>
          </div>
        )}
        {playlistUrl ? (
          <a href={playlistUrl} target="_blank" rel="noreferrer">
            <small>{t("listen")}</small>
            <strong>{t("spotifyPlaylist")}</strong>
            <PlaylistCoverageLabel
              coverage={
                playlistUrl === playlist?.spotifyUrl ? playlist.coverage?.spotify : undefined
              }
            />
          </a>
        ) : (
          <div className="disabled">
            <small>{t("listen")}</small>
            <strong>{t("playlistSoon")}</strong>
          </div>
        )}
        {youtubePlaylistUrl ? (
          <a href={youtubePlaylistUrl} target="_blank" rel="noreferrer">
            <small>{t("listen")}</small>
            <strong>{t("youtubeMusicPlaylist")}</strong>
            <PlaylistCoverageLabel
              coverage={
                youtubePlaylistUrl === playlist?.youtubeMusicUrl
                  ? playlist.coverage?.youtubeMusic
                  : undefined
              }
            />
          </a>
        ) : null}
        {setlistUrl ? (
          <a href={setlistUrl} target="_blank" rel="noreferrer">
            <small>{t("liveHistory")}</small>
            <strong>setlist.fm ↗</strong>
          </a>
        ) : (
          <div className="disabled">
            <small>{t("liveHistory")}</small>
            <strong>{t("unavailable")}</strong>
          </div>
        )}
      </div>
      <FestivalOverview overview={overview} />
      {item.editionYear && (
        <OfflineTripDownload
          key={`${item.slug}:${item.editionYear}`}
          slug={item.slug}
          year={item.editionYear}
        />
      )}
      <section className="lineupSection">
        <div className="sectionHeading">
          <div>
            <div className="eyebrow">{t("discoverBill")}</div>
            <h2>{t("lineup2027")}</h2>
          </div>
          <span>
            {artistCount} {t("announced")}
          </span>
        </div>
        {item.headliners.length > 0 && (
          <>
            <h3>{t("headliners")}</h3>
            <div className="headlinerGrid">
              {item.headliners.map((artist) => (
                <Link href={`/artists/${artistSlugs[artist]}/`} key={artist}>
                  {artist}
                  <span>{t("viewArtist")}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        {!hasArtists && (
          <div className="lineupEmpty">
            <strong>{t("noArtists")}</strong>
            <span>{t("noArtistsText")}</span>
          </div>
        )}
        {item.lineup.length > 0 && (
          <>
            <h3>{t(item.headliners.length > 0 ? "alsoAnnounced" : "announcedActs")}</h3>
            <label className="lineupSort">
              {t("lineupSort")}
              <select
                value={lineupSort}
                onChange={(event) => setLineupSort(event.target.value as LineupSort)}
              >
                <option value="official">{t("lineupOfficial")}</option>
                <option value="alphabetical">{t("lineupAlphabetical")}</option>
                <option value="chronological">{t("lineupChronological")}</option>
                <option value="popularity">{t("lineupPopularity")}</option>
              </select>
            </label>
            <div className="lineupGrid">
              {sortedLineup.map((artist) => (
                <Link href={`/artists/${artistSlugs[artist]}/`} key={artist}>
                  {artist}
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
      <PlanningTools
        item={item}
        festivals={festivals}
        discoveryLineups={discoveryLineups}
        favorites={planner.favoriteArtists}
      />
      <FestivalArrival facts={arrivalFacts} />
      <section className="sourceNote">
        <strong>{t("transparency")}</strong>
        <p>
          {item.freshness?.checkedAt ? (
            <>
              {t("latestSourceCheck")} ·{" "}
              <time dateTime={item.freshness.checkedAt}>
                {formatFreshnessDate(item.freshness.checkedAt, locale)}
              </time>
            </>
          ) : (
            t("sourceCheckUnavailable")
          )}
        </p>
        {item.freshness?.sourceCheckStale && <p>{t("sourceCheckStale")}</p>}
        {item.freshness?.lastPublishedAt && (
          <p>
            {t("latestCatalogPublication")} ·{" "}
            <time dateTime={item.freshness.lastPublishedAt}>
              {formatFreshnessDate(item.freshness.lastPublishedAt, locale)}
            </time>
          </p>
        )}
        <p>{item.sourceDeprecated ? t("sourceDeprecatedHelp") : t("sourceText")}</p>
        <a href={item.officialUrl} target="_blank" rel="noreferrer">
          {t("primarySource")}
        </a>
      </section>
      {item.editionYear !== undefined && (
        <CorrectionReportForm
          identity={{ target: "edition", slug: item.slug, year: item.editionYear }}
        />
      )}
    </div>
  );
}
