import { artistAliasIndex } from "./artist-aliases.ts";
import { verifiedSpotifyArtistId } from "../artist-spotify-identity.ts";
import type { PrismaClient } from "@prisma/client";
import type { ArtistProfile } from "../domain/artist.ts";
import type { FestivalEdition } from "../domain/edition.ts";
import type { Festival, PlaylistStatus, TimetableEntry } from "../domain/festival.ts";
import { editionKey, latestDate, readFreshnessEvidence } from "./freshness.ts";
import type { CatalogFreshness } from "../domain/freshness.ts";

export type CatalogSnapshot = Readonly<{
  festivals: Festival[];
  editions: readonly FestivalEdition[];
  artists: ArtistProfile[];
  playlists: Readonly<Record<string, PlaylistStatus>>;
  freshness: CatalogFreshness;
}>;
export interface CatalogRepository {
  read(): Promise<CatalogSnapshot>;
}

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10);
const instant = (value: Date | null) => value?.toISOString();
const lower = <T extends string>(value: T) => value.toLocaleLowerCase() as Lowercase<T>;

type CatalogReader = Pick<
  PrismaClient,
  "festivalEdition" | "artist" | "catalogPublication" | "$queryRaw"
>;

export class DatabaseCatalogRepository implements CatalogRepository {
  private readonly client: CatalogReader;

  constructor(client: CatalogReader) {
    this.client = client;
  }

  async read({ includeFreshness = false } = {}): Promise<CatalogSnapshot> {
    const now = new Date();
    const [editionRows, artistRows, freshnessEvidence] = await Promise.all([
      this.client.festivalEdition.findMany({
        include: {
          festival: true,
          sources: { where: { enabled: true }, select: { deprecatedAt: true } },
          lineup: {
            where: { status: "ANNOUNCED" },
            include: { artist: true },
            orderBy: [{ billing: "asc" }, { position: "asc" }],
          },
          provenance: { orderBy: [{ field: "asc" }, { checkedAt: "asc" }] },
          timetable: { orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }] },
          playlists: { orderBy: { provider: "asc" } },
        },
        orderBy: [{ year: "asc" }, { festival: { catalogOrder: "asc" } }],
      }),
      this.client.artist.findMany({
        include: {
          identities: { orderBy: { position: "asc" } },
          links: { orderBy: { position: "asc" } },
          provenance: { orderBy: { position: "asc" } },
        },
        orderBy: { slug: "asc" },
      }),
      includeFreshness ? readFreshnessEvidence(this.client, now) : undefined,
    ]);
    if (!editionRows.length || !artistRows.length)
      throw new Error("database catalogue is empty or incomplete");

    const editions = editionRows.map((row) => {
      const headliners = row.lineup
        .filter(({ billing }) => billing === "HEADLINER")
        .map(({ artist }) => artist.name);
      const lineup = row.lineup
        .filter(({ billing }) => billing === "LINEUP")
        .map(({ artist }) => artist.name);
      const checks = freshnessEvidence?.checksByEdition.get(row.id) ?? [];
      const lastSuccessfulSourceCheckAt = latestDate(
        checks.map(({ checkedAt }) => instant(checkedAt)),
      );
      const provenanceCheckedAt = latestDate(
        row.provenance
          .filter(({ checkedAt }) => checkedAt <= now)
          .map(({ checkedAt }) => checkedAt.toISOString()),
      );
      const roster = row.lineup.map(({ artist }) => artist);
      const aliases = row.timetable.length ? artistAliasIndex(roster) : undefined;
      const rosterById = new Map(roster.map((artist) => [artist.id, artist.name]));
      return {
        ...(freshnessEvidence && {
          freshness: {
            lastSuccessfulSourceCheckAt,
            checkedAt: latestDate([lastSuccessfulSourceCheckAt, provenanceCheckedAt]),
            lastPublishedAt: freshnessEvidence.publishedByEdition.get(
              editionKey(row.festival.slug, row.year),
            ),
            sourceCheckStale: checks.some(({ stale }) => stale),
          },
        }),
        slug: row.festival.slug,
        name: row.festival.name,
        country: row.festival.country,
        countryCode: row.festival.countryCode,
        city: row.festival.city ?? undefined,
        startDate: dateOnly(row.startDate),
        endDate: dateOnly(row.endDate),
        dateLabel: row.dateLabel ?? undefined,
        headliners,
        lineup,
        officialUrl: row.festival.officialUrl,
        ticketsUrl: row.ticketsUrl ?? undefined,
        status: lower(row.status),
        editionYear: row.year,
        sourceDeprecated:
          !!row.sources?.length && row.sources.every((s) => s.deprecatedAt !== null),
        sourceDeprecatedAt:
          row.sources?.length && row.sources.every((s) => s.deprecatedAt !== null)
            ? row.sources.map((s) => s.deprecatedAt!.toISOString()).sort()[0]
            : undefined,
        ticketStatus: lower(row.ticketStatus),
        updatedAt: row.sourceUpdatedAt.toISOString(),
        genres: row.festival.genres,
        coordinates:
          row.festival.latitude === null || row.festival.longitude === null
            ? undefined
            : { latitude: row.festival.latitude, longitude: row.festival.longitude },
        timetable: row.timetable.length
          ? row.timetable.map((performance): TimetableEntry => {
              const owners = performance.artistId ? [] : aliases!(performance.artistName);
              const name =
                (performance.artistId && rosterById.get(performance.artistId)) ||
                (owners.length === 1 ? owners[0].name : performance.artistName);
              return {
                date: dateOnly(performance.date)!,
                stage: performance.stage,
                start: performance.start,
                artist: name,
                timeZone: performance.timeZone ?? "UTC",
                status: performance.status === "CANCELLED" ? "cancelled" : "scheduled",
                sourceUrl: performance.sourceUrl ?? row.festival.officialUrl,
                observedAt: instant(performance.observedAt) ?? row.sourceUpdatedAt.toISOString(),
              };
            })
          : undefined,
        recordState: lower(row.recordState),
        completeness: lower(row.completeness),
        snapshotAt: instant(row.snapshotAt),
        provenance: row.provenance.map((source) => ({
          field: source.field as "edition" | "dates" | "lineup",
          url: source.url,
          checkedAt: source.checkedAt.toISOString(),
          note: source.note,
        })),
      } satisfies FestivalEdition;
    });
    const currentEditions = editions.filter(({ recordState }) => recordState === "current");
    const currentArtistNames = new Set(
      currentEditions.flatMap(({ headliners, lineup }) => [...headliners, ...lineup]),
    );
    const festivalsFromDatabase: Festival[] = currentEditions.map((edition) => {
      const {
        recordState: _recordState,
        snapshotAt: _snapshotAt,
        provenance: _provenance,
        ...festival
      } = edition;
      return {
        ...festival,
        headliners: [...festival.headliners],
        lineup: [...festival.lineup],
      };
    });
    const artists: ArtistProfile[] = artistRows
      .filter((row) => currentArtistNames.has(row.name))
      .map((row) => ({
        name: row.name,
        slug: row.slug,
        aliases: row.aliases,
        origin: row.origin ?? undefined,
        genres: row.genres,
        biography: row.biography ?? undefined,
        image:
          row.imageUrl && row.imageAlt && row.imageWidth && row.imageHeight
            ? {
                url: row.imageUrl,
                alt: row.imageAlt,
                width: row.imageWidth,
                height: row.imageHeight,
              }
            : undefined,
        identities: Object.fromEntries(
          row.identities.map(({ provider, externalId }) => [provider, externalId]),
        ) as ArtistProfile["identities"],
        identityState: lower(row.identityState),
        links: row.links.map(({ label, url, source, verified }) => ({
          label,
          url,
          source: source as ArtistProfile["links"][number]["source"],
          verified,
        })),
        spotifyStats:
          row.spotifyStatsCheckedAt &&
          row.spotifyStatsArtistId &&
          row.spotifyStatsArtistId === verifiedSpotifyArtistId(row) &&
          row.spotifyStatsSourceUrl
            ? {
                popularity: row.spotifyPopularity,
                followers: row.spotifyFollowers === null ? null : Number(row.spotifyFollowers),
                checkedAt: row.spotifyStatsCheckedAt.toISOString(),
                artistId: row.spotifyStatsArtistId!,
                sourceUrl: row.spotifyStatsSourceUrl,
              }
            : undefined,
        topTracks: row.topTracks,
        recentSetlists: row.recentSetlists as ArtistProfile["recentSetlists"],
        provenance: row.provenance.map(({ field, source, url, checkedAt }) => ({
          field,
          source: source as ArtistProfile["provenance"][number]["source"],
          url,
          checkedAt: checkedAt.toISOString().slice(0, 10),
        })),
        freshness: row.freshness as ArtistProfile["freshness"],
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const playlists: Record<string, PlaylistStatus> = {};
    for (const row of editionRows.filter(({ recordState }) => recordState === "CURRENT")) {
      const spotify = row.playlists.find(({ provider }) => provider === "spotify");
      const youtube = row.playlists.find(({ provider }) => provider === "youtube_music");
      if (!spotify) continue;
      playlists[row.festival.slug] = {
        spotifyUrl: spotify.url,
        youtubeMusicUrl: youtube?.url,
        youtubeMusicArtists: youtube?.artistCount ?? undefined,
        youtubeMusicTracks: youtube?.trackCount ?? undefined,
        artists: spotify.artistCount ?? row.lineup.length,
        tracks: spotify.trackCount ?? 0,
        updatedAt: instant(spotify.syncedAt) ?? row.sourceUpdatedAt.toISOString(),
      };
    }
    const freshness = {
      checkedAt: latestDate(currentEditions.map(({ freshness }) => freshness?.checkedAt)),
      lastPublishedAt: latestDate(
        currentEditions.map(({ freshness }) => freshness?.lastPublishedAt),
      ),
    };
    return Object.freeze({
      festivals: festivalsFromDatabase,
      editions,
      artists,
      playlists,
      freshness,
    });
  }
}

export async function readCatalog(
  options: { database?: PrismaClient; includeFreshness?: boolean } = {},
): Promise<CatalogSnapshot> {
  const database = options.database ?? (await import("../db.ts")).db;
  return new DatabaseCatalogRepository(database).read({
    includeFreshness: options.includeFreshness,
  });
}

export function getCatalog(options?: { includeFreshness?: boolean }) {
  return readCatalog(options);
}
