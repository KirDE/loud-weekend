import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
import { seedCatalog } from "./support/seed-catalog.ts";
import { DatabaseCatalogRepository, readCatalog } from "../lib/catalog/repository.ts";
import { catalogSeed, festival } from "./support/catalog.ts";
import { createIngestionRun, persistAttempt } from "../lib/ingestion/repository.ts";
import {
  publishAdminFestivalChange,
  publishAgentFestivalResolution,
} from "../lib/catalog/publication.ts";
import type { IngestionResult } from "../lib/ingestion/types.ts";
import { brutalAssaultVenueSource } from "../lib/ingestion/adapters/brutal-assault-venue.ts";
import { collectReviewedVenue } from "../lib/ingestion/venue-collector.ts";
import sitemap from "../app/sitemap.ts";
import { importLineupDays } from "../lib/catalog/lineup-days-import.ts";
import { readEditionHistory, readPublicAnnouncements } from "../lib/catalog/public-history.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) {
  throw new Error("A test or integration DATABASE_URL is required");
}

const db = createPrismaClient();
async function clearCatalog() {
  await db.festivalSource.deleteMany();
  await db.festival.deleteMany();
  await db.artist.deleteMany();
}

test.before(async () => {
  await clearCatalog();
  await seedCatalog(db, catalogSeed);
});
test.after(async () => {
  await clearCatalog();
  await db.$disconnect();
});

test("database repository preserves the public catalogue projection", async () => {
  const snapshot = await new DatabaseCatalogRepository(db).read();
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.festivals)),
    JSON.parse(
      JSON.stringify(
        catalogSeed.festivals.map((f) => ({
          ...f,
          completeness: catalogSeed.editions.find(
            (e) => e.slug === f.slug && e.recordState === "current",
          )!.completeness,
          sourceDeprecated: false,
        })),
      ),
    ),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.artists)),
    JSON.parse(JSON.stringify(catalogSeed.artists)),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.playlists)),
    JSON.parse(JSON.stringify(catalogSeed.playlists)),
  );
  assert.equal(snapshot.editions.length, catalogSeed.editions.length);
  assert.equal(
    snapshot.editions.find(
      ({ slug, editionYear }) => slug === "synthetic-fest" && editionYear === 2026,
    )?.recordState,
    "archived",
  );
});

test("database reads fail closed without a file fallback", async () => {
  const failure = new Error("catalogue database unavailable");
  const failingDatabase = {
    $transaction: async () => {
      throw failure;
    },
    artist: { findMany: async () => [] },
  } as unknown as PrismaClient;
  await assert.rejects(
    readCatalog({ database: failingDatabase }),
    /catalogue database unavailable/,
  );
});

test("database reads do not retain a process-lifetime catalogue snapshot", async () => {
  const before = await readCatalog({ database: db });
  const originalName = before.festivals[0].name;
  const changedName = `${originalName} fresh-read-check`;
  await db.festival.update({
    where: { slug: before.festivals[0].slug },
    data: { name: changedName },
  });
  try {
    const after = await readCatalog({ database: db });
    assert.equal(after.festivals[0].name, changedName);
  } finally {
    await db.festival.update({
      where: { slug: before.festivals[0].slug },
      data: { name: originalName },
    });
  }
});

test("reviewed lineup days are edition-bound, audited, and independent of stage schedules", async () => {
  const slug = `lineup-days-${randomUUID()}`;
  await db.festival.update({ where: { slug: "synthetic-fest" }, data: { slug } });
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { year: 2027, festival: { slug } },
  });
  const artist = await db.artist.findUniqueOrThrow({ where: { slug: "sample-artist" } });
  const spare = await db.artist.create({
    data: {
      name: "Unassigned act",
      slug: "unassigned-act",
      identityState: "UNRESOLVED",
      recentSetlists: [],
      freshness: {},
    },
  });
  const auditScope = { action: "lineup_day_allocation.publish", target: edition.id };
  const receiptScope = {
    festivalSlug: slug,
    editionYear: 2027,
    fields: { equals: ["lineupDays"] },
  };
  const day = (date: string) => new Date(date + "T00:00:00Z");
  const input = {
    festivalSlug: slug,
    editionYear: 2027,
    startDate: "2027-07-31",
    endDate: "2027-08-02",
    sourceUrl: "https://festival.example.test/2027/lineup-by-day",
    observedAt: "2026-10-01T00:30:00+02:00",
    entries: [{ artistSlug: artist.slug, dates: ["2027-07-31"], status: "announced" }],
  };
  const read = async () =>
    (await readCatalog({ database: db, includeFreshness: true })).festivals[0];
  try {
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: {
        startDate: day(input.startDate),
        endDate: day(input.endDate),
      },
    });
    await db.lineupEntry.create({
      data: {
        editionId: edition.id,
        artistId: spare.id,
        billing: "LINEUP",
        position: 0,
      },
    });
    assert.equal((await read()).lineupDays, undefined);
    assert.deepEqual(await importLineupDays(db, input), { checkOnly: true, changed: 1 });
    assert.equal(await db.adminAuditEntry.count({ where: auditScope }), 0);
    assert.equal(await db.catalogPublication.count({ where: receiptScope }), 0);
    assert.equal(
      await db.editionLineupDayAllocation.count({ where: { editionId: edition.id } }),
      0,
    );
    await assert.rejects(
      importLineupDays(db, { ...input, editionYear: 2026 }, false),
      /match the selected edition/,
    );
    await assert.rejects(
      importLineupDays(db, { ...input, sourceUrl: "https://other.example.test/lineup" }, false),
      /official origin/,
    );
    await assert.rejects(
      importLineupDays(db, { ...input, sourceUrl: input.sourceUrl + "?private=1" }, false),
      /public HTTPS source/,
    );
    await assert.rejects(
      importLineupDays(
        db,
        {
          ...input,
          entries: [
            {
              ...input.entries[0],
              dates: ["2027-08-03"],
            },
          ],
        },
        false,
      ),
      /within the selected edition/,
    );
    await assert.rejects(
      importLineupDays(
        db,
        {
          ...input,
          entries: [
            ...input.entries,
            { artistSlug: "other-edition-act", dates: [], status: "announced" },
          ],
        },
        false,
      ),
      /distinct artist/,
    );
    assert.equal(await db.adminAuditEntry.count({ where: auditScope }), 0);
    assert.equal(await db.catalogPublication.count({ where: receiptScope }), 0);
    assert.equal(
      await db.editionLineupDayAllocation.count({ where: { editionId: edition.id } }),
      0,
    );

    const results = await Promise.allSettled([
      importLineupDays(db, input, false),
      importLineupDays(db, input, false),
    ]);
    assert.ok(
      results.some((result) => result.status === "fulfilled" && result.value.changed === 1),
    );
    assert.deepEqual(await importLineupDays(db, input, false), { checkOnly: false, changed: 0 });
    assert.equal(await db.adminAuditEntry.count({ where: auditScope }), 1);
    const receipt = await db.catalogPublication.findFirstOrThrow({ where: receiptScope });
    assert.equal(await db.catalogPublication.count({ where: receiptScope }), 1);
    assert.equal(receipt.lineupChanged, false);
    assert.equal((await read()).freshness?.lastPublishedAt, receipt.createdAt.toISOString());
    const expectedHistory = [
      { publishedAt: receipt.createdAt.toISOString(), categories: ["lineup"] },
    ];
    assert.deepEqual(await readEditionHistory(db, slug, 2027), expectedHistory);
    assert.deepEqual(await readEditionHistory(db, slug, 2026), []);
    const artistAnnouncements = async (artistSlug: string) => {
      const { entries } = await readPublicAnnouncements(db, {
        artist: artistSlug,
        country: "",
        days: null,
        page: 1,
      });
      return entries.filter((entry) => entry.slug === slug);
    };
    assert.deepEqual(
      (await artistAnnouncements(artist.slug)).map(({ year, categories }) => ({
        year,
        categories,
      })),
      [{ year: 2027, categories: ["lineup"] }],
    );
    assert.deepEqual(await artistAnnouncements(spare.slug), []);

    const reobservation = { ...input, observedAt: "2026-10-01T12:00:00Z" };
    assert.deepEqual(await importLineupDays(db, reobservation), { checkOnly: true, changed: 0 });
    assert.deepEqual(await importLineupDays(db, reobservation, false), {
      checkOnly: false,
      changed: 0,
    });
    assert.equal(await db.catalogPublication.count({ where: receiptScope }), 1);
    assert.equal(await db.adminAuditEntry.count({ where: auditScope }), 1);
    assert.deepEqual(await readEditionHistory(db, slug, 2027), expectedHistory);
    assert.equal((await read()).freshness?.lastPublishedAt, receipt.createdAt.toISOString());
    assert.equal(
      (await read()).lineupDays?.find((row) => row.artistSlug === artist.slug)?.observedAt,
      "2026-10-01T12:00:00.000Z",
    );
    assert.equal((await read()).timetable, undefined);
    await db.lineupEntry.update({
      where: { editionId_artistId: { editionId: edition.id, artistId: artist.id } },
      data: { status: "CANCELLED" },
    });
    const playlist = await db.festivalPlaylist.create({
      data: {
        editionId: edition.id,
        provider: "spotify",
        url: "https://open.spotify.com/playlist/3234567890123456789012",
      },
    });
    try {
      const { playlists } = await readCatalog({ database: db });
      assert.equal(playlists[slug].artists, 1);
    } finally {
      await db.festivalPlaylist.delete({ where: { id: playlist.id } });
    }
    const afterCancellation = await read();
    assert.ok(
      ![...afterCancellation.headliners, ...afterCancellation.lineup].includes(artist.name),
    );
    const cancelled = afterCancellation.lineupDays?.find((row) => row.artistSlug === artist.slug);
    assert.equal(cancelled?.cancelled, true);
    assert.deepEqual(cancelled?.dates, ["2027-07-31"]);
    assert.equal(cancelled?.sourceUrl, input.sourceUrl);
    assert.deepEqual(
      (await read()).lineupDays?.find((row) => row.artistSlug === spare.slug)?.dates,
      [],
    );
    const revision = {
      ...input,
      entries: [{ artistSlug: artist.slug, dates: ["2027-08-01"], status: "cancelled" }],
      observedAt: "2026-10-02T12:00:00Z",
    };
    await assert.rejects(
      importLineupDays(db, { ...revision, observedAt: "2026-10-01T06:00:00Z" }, false),
      /newer official observation/,
    );
    assert.equal((await importLineupDays(db, revision, false)).changed, 1);
    assert.equal(await db.catalogPublication.count({ where: receiptScope }), 2);
    assert.equal((await artistAnnouncements(artist.slug)).length, 2);
    assert.deepEqual(await artistAnnouncements(spare.slug), []);
    await assert.rejects(importLineupDays(db, input, false), /newer official observation/);
    const readback = (await read()).lineupDays?.find((row) => row.artistSlug === artist.slug);
    assert.deepEqual(readback, {
      artist: artist.name,
      artistSlug: artist.slug,
      dates: ["2027-08-01"],
      cancelled: true,
      sourceUrl: input.sourceUrl,
      observedAt: revision.observedAt.replace("Z", ".000Z"),
    });
    const removed = await db.lineupEntry.delete({
      where: { editionId_artistId: { editionId: edition.id, artistId: artist.id } },
    });
    try {
      const afterRemoval = await read();
      assert.deepEqual(
        afterRemoval.lineupDays?.find((row) => row.artistSlug === artist.slug),
        readback,
      );
      assert.ok(![...afterRemoval.headliners, ...afterRemoval.lineup].includes(artist.name));
      const corrected = {
        ...input,
        entries: [{ artistSlug: artist.slug, dates: ["2027-08-02"], status: "cancelled" }],
        observedAt: "2026-10-03T12:00:00Z",
      };
      assert.equal((await importLineupDays(db, corrected, false)).changed, 1);
      const afterCorrection = await read();
      assert.deepEqual(
        afterCorrection.lineupDays?.find((row) => row.artistSlug === artist.slug)?.dates,
        ["2027-08-02"],
      );
      assert.ok(![...afterCorrection.headliners, ...afterCorrection.lineup].includes(artist.name));
    } finally {
      await db.lineupEntry.create({ data: removed });
    }
    const audit = await db.adminAuditEntry.findFirstOrThrow({
      where: { ...auditScope, beforeValue: { path: ["status"], equals: "ANNOUNCED" } },
    });
    assert.deepEqual((audit.beforeValue as { dates: string[] }).dates, ["2027-07-31"]);
    assert.deepEqual((audit.afterValue as { dates: string[] }).dates, ["2027-08-01"]);
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: { startDate: day("2027-08-01") },
    });
    assert.equal((await read()).lineupDays, undefined);
  } finally {
    await db.festival.update({ where: { slug }, data: { slug: "synthetic-fest" } });
    await db.lineupEntry.update({
      where: { editionId_artistId: { editionId: edition.id, artistId: artist.id } },
      data: { status: "ANNOUNCED" },
    });
    await db.editionLineupDayAllocation.deleteMany({ where: { editionId: edition.id } });
    await db.lineupEntry.deleteMany({ where: { artistId: spare.id } });
    await db.artist.delete({ where: { id: spare.id } });
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: {
        startDate: edition.startDate,
        endDate: edition.endDate,
      },
    });
  }
});

test("public data quality does not count schedule rows with only fallback evidence", async () => {
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug: "synthetic-fest" }, recordState: "CURRENT" },
  });
  const base = {
    editionId: edition.id,
    date: new Date("2027-06-11"),
    stage: "Fixture stage",
    start: "20:45",
    timeZone: "Europe/Berlin",
    sourceUrl: "https://festival.example.test/private-schedule-fixture",
    observedAt: new Date("2026-11-21T09:00:00Z"),
  };
  await db.timetablePerformance.createMany({
    data: [
      {
        ...base,
        artistName: "All evidence missing",
        sourceUrl: null,
        observedAt: null,
        timeZone: null,
      },
      { ...base, artistName: "Missing schedule source", sourceUrl: null },
      { ...base, artistName: "Missing schedule observation", observedAt: null },
      { ...base, artistName: "Missing schedule time zone", timeZone: null },
    ],
  });
  try {
    const qualityRead = () =>
      readCatalog({ database: db, includeFreshness: true, requireTimetableEvidence: true });
    assert.equal((await readCatalog({ database: db })).festivals[0].timetable?.length, 4);
    const { summarizeDataQuality } = await import("../lib/catalog/data-quality.ts");
    assert.equal(summarizeDataQuality(await qualityRead()).timetable, 0);
    await db.timetablePerformance.create({ data: { ...base, artistName: "Verified fixture" } });
    const summary = summarizeDataQuality(await qualityRead());
    assert.equal(summary.timetable, 1);
    assert.doesNotMatch(JSON.stringify(summary), /private-schedule-fixture|Verified fixture/);
  } finally {
    await db.timetablePerformance.deleteMany({ where: { editionId: edition.id } });
  }
});

test("cancelled artists do not count as announced in the public catalogue", async () => {
  const entry = await db.lineupEntry.findFirstOrThrow({
    where: { edition: { recordState: "CURRENT", festival: { slug: "synthetic-fest" } } },
  });
  const playlist = await db.festivalPlaylist.create({
    data: {
      editionId: entry.editionId,
      provider: "spotify",
      url: "https://open.spotify.com/playlist/3234567890123456789012",
    },
  });
  await db.lineupEntry.update({ where: { id: entry.id }, data: { status: "CANCELLED" } });
  try {
    const snapshot = await readCatalog({ database: db });
    assert.deepEqual(snapshot.festivals[0].headliners, []);
    assert.deepEqual(
      snapshot.editions.find(({ recordState }) => recordState === "current")?.headliners,
      [],
    );
    assert.deepEqual(snapshot.discoveryLineups.artistSlugsByFestival["synthetic-fest"], []);
    assert.deepEqual(snapshot.artists, []);
    assert.equal(snapshot.playlists["synthetic-fest"].artists, 0);
  } finally {
    await db.festivalPlaylist.delete({ where: { id: playlist.id } });
    await db.lineupEntry.update({ where: { id: entry.id }, data: { status: "ANNOUNCED" } });
  }
});

test("provider playlist coverage reads the current edition and independent measured timestamps", async () => {
  const current = await db.festivalEdition.findFirstOrThrow({ where: { recordState: "CURRENT" } });
  const archived = await db.festivalEdition.findFirstOrThrow({
    where: { recordState: "ARCHIVED" },
  });
  const spotifyUrl = "https://open.spotify.com/playlist/1234567890123456789012";
  const youtubeUrl = "https://music.youtube.com/playlist?list=Synthetic01";
  const firstSync = new Date("2026-11-18T14:00:00.000Z");
  const secondSync = new Date("2026-11-20T12:00:00.000Z");
  const get = async () => (await readCatalog({ database: db })).playlists["synthetic-fest"];
  await db.festivalPlaylist.createMany({
    data: [
      {
        editionId: archived.id,
        provider: "spotify",
        url: spotifyUrl,
        artistCount: 999,
        trackCount: 1999,
        syncedAt: secondSync,
      },
      {
        editionId: current.id,
        provider: "youtube_music",
        url: youtubeUrl,
        artistCount: 8,
        trackCount: 14,
        syncedAt: firstSync,
      },
    ],
  });
  let playlist = await get();
  assert.equal(playlist.spotifyUrl, undefined);
  assert.equal(playlist.youtubeMusicUrl, youtubeUrl);
  assert.deepEqual(playlist.coverage?.youtubeMusic, {
    reportedArtists: 8,
    tracks: 14,
    recordedAt: firstSync.toISOString(),
  });

  const currentSpotifyUrl = "https://open.spotify.com/playlist/2234567890123456789012";
  const currentSpotify = await db.festivalPlaylist.create({
    data: {
      editionId: current.id,
      provider: "spotify",
      url: currentSpotifyUrl,
      artistCount: 110,
      trackCount: 220,
      syncedAt: secondSync,
    },
  });
  playlist = await get();
  assert.equal(playlist.spotifyUrl, currentSpotifyUrl);
  // The legacy Spotify count includes artists with no usable tracks.
  assert.equal(playlist.coverage?.spotify, undefined);
  await db.festivalPlaylist.update({
    where: { id: currentSpotify.id },
    data: {
      coverageEvidence: {
        recordedAt: secondSync.toISOString(),
        matchedArtists: 100,
        eligibleArtists: 110,
      },
    },
  });
  playlist = await get();
  assert.deepEqual(playlist.coverage?.spotify?.verified, {
    matchedArtists: 100,
    eligibleArtists: 110,
  });
  await db.festivalPlaylist.update({ where: { id: currentSpotify.id }, data: { syncedAt: null } });
  playlist = await get();
  assert.equal(playlist.spotifyUrl, currentSpotifyUrl);
  assert.equal(playlist.coverage?.spotify, undefined);
  assert.equal(playlist.coverage?.youtubeMusic?.recordedAt, firstSync.toISOString());
});

test("public freshness separates edition-bound checks, publication and source failures", async () => {
  await clearCatalog();
  const slug = `freshness-${randomUUID()}`;
  await seedCatalog(db, {
    ...catalogSeed,
    festivals: [{ ...festival, slug }],
    editions: catalogSeed.editions.map((edition) => ({ ...edition, slug })),
  });
  const [archived, current] = await db.festivalEdition.findMany({
    where: { festival: { slug } },
    orderBy: { year: "asc" },
  });
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000);
  const read = () => readCatalog({ database: db, includeFreshness: true });
  const sitemapDates = async () =>
    Object.fromEntries(
      (await sitemap()).map(({ url, lastModified }) => [new URL(url).pathname, lastModified]),
    );
  const createSource = (
    suffix: string,
    options: { enabled: boolean; archived?: boolean; cadenceSeconds?: number },
  ) => {
    const edition = options.archived ? archived : current;
    return db.festivalSource.create({
      data: {
        url: new URL(suffix, festival.officialUrl).href,
        festivalSlug: slug,
        festivalId: edition.festivalId,
        editionId: edition.id,
        editionYear: edition.year,
        enabled: options.enabled,
        refreshPolicy: options.archived ? "archived" : "daily",
        cadenceSeconds: options.cadenceSeconds ?? 86400,
        strategies: ["json_ld_event"],
        // An operational lease success is not sufficient public evidence.
        lastSuccessAt: now,
      },
    });
  };

  const run = await createIngestionRun(db, {
    trigger: "TEST",
    sourceCommit: "synthetic",
    totalSources: 1,
  });
  const attempt = async (
    url: string,
    endedAt: Date,
    years: number[],
    overrides: {
      review?: boolean;
      hasEvidence?: boolean;
      noHttp?: boolean;
    } = {},
  ) => {
    const result: IngestionResult = {
      schemaVersion: 1,
      festivalSlug: slug,
      sourceUrl: url,
      fetchedAt: endedAt.toISOString(),
      changes: [],
      publishable: false,
      reviewReasons: overrides.review ? ["Ambiguous"] : [],
      candidate: {
        schemaVersion: 1,
        festivalSlug: slug,
        sourceUrl: url,
        fetchedAt: endedAt.toISOString(),
        observedEditionYears: years,
        warnings: [],
        evidence:
          overrides.hasEvidence === false
            ? []
            : [{ field: "startDate", sourceUrl: url, observedAt: endedAt.toISOString() }],
        startDate: festival.startDate,
      },
    };
    return persistAttempt(db, {
      runId: run.id,
      festivalSlug: slug,
      requestedUrl: url,
      httpStatus: overrides.noHttp ? undefined : 200,
      startedAt: endedAt,
      endedAt,
      durationMs: 0,
      result,
    });
  };

  try {
    const noDates = await read();
    assert.equal(noDates.freshness.checkedAt, undefined);
    assert.equal(noDates.freshness.lastPublishedAt, undefined);
    assert.equal((await sitemapDates())[`/festivals/${slug}/`], undefined);

    const [active, disabled, old] = await Promise.all([
      createSource("live", { enabled: true }),
      createSource("disabled", { enabled: false }),
      createSource("old", { enabled: true, archived: true }),
    ]);
    await db.editionProvenance.createMany({
      data: [
        {
          editionId: current.id,
          field: "edition",
          url: active.url,
          checkedAt: ago(48),
          note: "Current edition evidence",
        },
        {
          editionId: archived.id,
          field: "edition",
          url: old.url,
          checkedAt: ago(1),
          note: "Archived edition evidence",
        },
        {
          editionId: current.id,
          field: "edition",
          url: active.url,
          checkedAt: ago(-24),
          note: "Future timestamp",
        },
      ],
    });
    await attempt(disabled.url, ago(1), [current.year]);
    await attempt(old.url, ago(1), [archived.year]);
    await attempt(active.url, ago(2), [archived.year]);
    await attempt(active.url, ago(2), [current.year, archived.year]);
    await attempt(active.url, ago(2), [current.year], { review: true });
    await attempt(active.url, ago(2), [current.year], { hasEvidence: false });
    await attempt(active.url, ago(2), [current.year], { noHttp: true });
    assert.equal((await read()).freshness.checkedAt, ago(48).toISOString());
    assert.equal((await read()).festivals[0].freshness?.lastSuccessfulSourceCheckAt, undefined);

    const validAt = ago(12);
    await attempt(active.url, validAt, [current.year]);
    const afterCheck = await read();
    assert.deepEqual(afterCheck.festivals[0].freshness, {
      checkedAt: validAt.toISOString(),
      lastSuccessfulSourceCheckAt: validAt.toISOString(),
      lastPublishedAt: undefined,
      sourceCheckStale: false,
    });
    assert.equal(afterCheck.freshness.checkedAt, validAt.toISOString());
    assert.equal((await sitemapDates())["/"], undefined, "a check is not a publication");

    await db.festivalSource.update({ where: { id: active.id }, data: { cadenceSeconds: 3600 } });
    assert.equal((await read()).festivals[0].freshness?.sourceCheckStale, true);
    await db.festivalSource.update({
      where: { id: active.id },
      data: {
        cadenceSeconds: 86400,
        consecutiveFailures: 1,
        lastAttemptAt: now,
        lastError: "private-error-fixture",
      },
    });
    const afterFailure = await read();
    assert.equal(afterFailure.festivals[0].freshness?.sourceCheckStale, true);
    assert.equal(afterFailure.freshness.checkedAt, validAt.toISOString());
    assert.doesNotMatch(
      JSON.stringify(afterFailure.festivals[0].freshness),
      /private-error-fixture/,
    );

    const publication = await db.$transaction((tx) =>
      publishAdminFestivalChange(tx, {
        actorLabel: "private-actor-fixture",
        change: {
          id: slug,
          resourceKey: slug,
          field: "city",
          beforeValue: festival.city,
          afterValue: "Updated City",
          sourceEvidence: null,
          parserRunId: null,
        },
      }),
    );
    assert.ok(publication);
    const published = publication.createdAt.toISOString();
    const archivePublished = new Date(Math.max(Date.now(), publication.createdAt.getTime()));
    await db.catalogPublication.create({
      data: {
        source: "ADMIN",
        sourceId: `${slug}-archived`,
        festivalSlug: slug,
        editionYear: archived.year,
        actorLabel: "private-actor-fixture",
        fields: ["lineup"],
        createdAt: archivePublished,
      },
    });
    const afterPublication = await read();
    assert.equal(afterPublication.festivals[0].city, "Updated City");
    assert.deepEqual(afterPublication.freshness, {
      checkedAt: validAt.toISOString(),
      lastPublishedAt: published,
    });
    assert.equal(
      afterPublication.editions.find((item) => item.editionYear === archived.year)?.freshness
        ?.lastPublishedAt,
      archivePublished.toISOString(),
    );
    assert.doesNotMatch(
      JSON.stringify(afterPublication.festivals[0].freshness),
      /private-actor-fixture/,
    );
    const dates = await sitemapDates();
    assert.equal(dates["/"], published);
    assert.equal(dates["/de/"], published);
    assert.equal(dates[`/festivals/${slug}/`], published);
    // A city change is visible on the current festival, country/month cards
    // and the appearing artist's page, but not on the edition dossier or listing.
    for (const path of [
      `/de/festivals/${slug}/`,
      "/artists/sample-artist/",
      "/ru/artists/sample-artist/",
      "/countries/de/",
      "/months/06/",
    ]) {
      assert.equal(dates[path], published, path);
    }
    assert.equal(dates[`/festivals/${slug}/2027/`], undefined);
    assert.equal(dates[`/festivals/${slug}/2026/`], archivePublished.toISOString());
    for (const path of ["/archive/", "/editions/2026/"])
      assert.equal(dates[path], archivePublished.toISOString(), path);
    for (const path of ["/submit/", "/editions/2027/"]) {
      assert.ok(path in dates);
      assert.equal(dates[path], undefined);
    }
    assert.ok(!("/months/12/" in dates));
    await db.catalogPublication.create({
      data: {
        source: "ADMIN",
        sourceId: `${slug}-future`,
        festivalSlug: slug,
        editionYear: current.year,
        actorLabel: "private-actor-fixture",
        fields: ["name"],
        createdAt: ago(-72),
      },
    });
    await db.festivalEdition.update({ where: { id: current.id }, data: { snapshotAt: ago(-72) } });
    assert.deepEqual(await sitemapDates(), dates, "future evidence may not change the sitemap");

    const arrival = await db.catalogPublication.create({
      data: {
        source: "INGESTION",
        sourceId: `${slug}-reviewed-arrival`,
        festivalSlug: slug,
        editionYear: current.year,
        actorLabel: "fixture",
        fields: ["arrival"],
        createdAt: new Date(),
      },
    });
    const arrivalDates = await sitemapDates();
    const arrivalDate = arrival.createdAt.toISOString();
    assert.equal(arrivalDates[`/festivals/${slug}/`], arrivalDate);
    assert.equal(arrivalDates[`/festivals/${slug}/2027/`], arrivalDate);
    for (const path of ["/archive/", "/editions/2027/", "/countries/de/", "/months/06/"]) {
      assert.equal(arrivalDates[path], dates[path], path);
    }

    const provenanceUrl = "https://official.example.test/ticket-update";
    const reviewedTicket = await db.$transaction((tx) =>
      publishAgentFestivalResolution(tx, {
        editionId: current.id,
        festivalSlug: slug,
        sourceId: `${slug}-reviewed-ticket`,
        reason: "Review the corrected official ticket link",
        facts: { ticketsUrl: "https://tickets.example.test/updated" },
        evidence: [
          {
            field: "ticketsUrl",
            url: provenanceUrl,
            excerpt: "Official ticket link has changed",
            contentHash: "a".repeat(64),
            checkedAt: validAt.toISOString(),
          },
        ],
        reviewedAt: validAt,
      }),
    );
    assert.ok(
      await db.editionProvenance.findFirst({
        where: { editionId: current.id, url: provenanceUrl, checkedAt: validAt },
      }),
    );
    assert.ok(reviewedTicket);
    const updatedDates = await sitemapDates();
    assert.equal(updatedDates[`/festivals/${slug}/2027/`], reviewedTicket.createdAt.toISOString());
    assert.equal(updatedDates["/editions/2027/"], undefined);
    assert.equal(updatedDates[`/festivals/${slug}/2026/`], archivePublished.toISOString());
    const finalLineup = await db.catalogPublication.create({
      data: {
        source: "ADMIN",
        sourceId: `${slug}-reviewed-final-lineup`,
        festivalSlug: slug,
        editionYear: current.year,
        actorLabel: "fixture",
        evidence: { reviewPolicy: "openclaw-import-conflicts-v1" },
        fields: ["finalLineup"],
      },
    });
    const finalDates = await sitemapDates();
    for (const path of [
      "/",
      "/de/",
      `/festivals/${slug}/`,
      `/festivals/${slug}/2027/`,
      "/countries/de/",
      "/months/06/",
      "/editions/2027/",
    ]) {
      assert.equal(finalDates[path], finalLineup.createdAt.toISOString(), path);
    }
    for (const path of ["/artists/sample-artist/", "/archive/", "/editions/2026/"]) {
      assert.equal(finalDates[path], updatedDates[path], path);
    }
    const overview = await db.catalogPublication.create({
      data: {
        source: "INGESTION",
        sourceId: `${slug}-overview`,
        festivalSlug: slug,
        editionYear: current.year,
        actorLabel: "fixture",
        evidence: {},
        fields: ["overview"],
      },
    });
    const overviewDates = await sitemapDates();
    for (const path of ["/", "/de/", `/festivals/${slug}/`, `/ru/festivals/${slug}/`])
      assert.equal(overviewDates[path], overview.createdAt.toISOString(), path);
    for (const path of ["/editions/2027/", "/countries/de/", "/months/06/"])
      assert.equal(overviewDates[path], finalDates[path], path);
  } finally {
    // Publication receipts are append-only; the unique fixture slug isolates reruns.
    await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
    await db.ingestionCandidate.deleteMany({ where: { runId: run.id } });
    await db.ingestionRun.delete({ where: { id: run.id } });
  }
});

test("reviewed public venue changes advance only homepage and festival sitemap dates", async () => {
  const { festivalSlug: slug, countryCode, organizerHost, sourceUrl } = brutalAssaultVenueSource;
  await seedCatalog(db, {
    ...catalogSeed,
    festivals: [
      {
        ...festival,
        slug,
        countryCode,
        city: "Jaroměř",
        officialUrl: `https://${organizerHost}/`,
      },
    ],
    editions: catalogSeed.editions.map((edition) => ({ ...edition, slug })),
  });
  const sitemapDates = async () =>
    Object.fromEntries(
      (await sitemap()).map(({ url, lastModified }) => [new URL(url).pathname, lastModified]),
    );
  const before = await sitemapDates();
  const original = readFileSync(
    new URL("./fixtures/brutal-assault/about-venue.html", import.meta.url),
    "utf8",
  );
  let fixtureVenue = "Updated fixture venue";
  const fetchImpl: typeof fetch = async () => {
    const response = new Response(original.replace("Josefov Fortress", fixtureVenue), {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: sourceUrl });
    return response;
  };

  const preview = await collectReviewedVenue(db, 2027, { fetchImpl });
  assert.deepEqual(await sitemapDates(), before);
  await collectReviewedVenue(db, 2027, { fetchImpl, approval: preview.token, actor: "fixture" });
  const { festivals } = await new DatabaseCatalogRepository(db).read();
  assert.equal(festivals.find((item) => item.slug === slug)?.venue?.name, "Updated fixture venue");
  const receipt = await db.catalogPublication.findFirstOrThrow({
    where: { festivalSlug: slug, editionYear: 2027, fields: { has: "venue" } },
  });
  const lastModified = receipt.createdAt.toISOString();
  const expected = (date: string) => ({
    ...before,
    ...Object.fromEntries(
      ["", "/en", "/de", "/ru"].flatMap((prefix) => [
        [`${prefix}/`, date],
        [`${prefix}/festivals/${slug}/`, date],
      ]),
    ),
  });
  const published = await sitemapDates();
  assert.deepEqual(published, expected(lastModified));

  const repeat = await collectReviewedVenue(db, 2027, { fetchImpl });
  await collectReviewedVenue(db, 2027, { fetchImpl, approval: repeat.token, actor: "fixture" });
  assert.equal(await db.catalogPublication.count({ where: { festivalSlug: slug } }), 1);
  assert.deepEqual(await sitemapDates(), published);

  fixtureVenue = "Renamed fixture venue";
  const rename = await collectReviewedVenue(db, 2027, { fetchImpl });
  assert.deepEqual(await sitemapDates(), published);
  await collectReviewedVenue(db, 2027, { fetchImpl, approval: rename.token, actor: "fixture" });
  const renamed = await db.catalogPublication.findFirstOrThrow({
    where: { festivalSlug: slug, editionYear: 2027, fields: { has: "venue" } },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(renamed.createdAt > receipt.createdAt);
  assert.deepEqual(await sitemapDates(), expected(renamed.createdAt.toISOString()));
});
