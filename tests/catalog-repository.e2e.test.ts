import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
import { seedCatalog } from "./support/seed-catalog.ts";
import { DatabaseCatalogRepository, readCatalog } from "../lib/catalog/repository.ts";
import { catalogSeed, festival } from "./support/catalog.ts";
import { createIngestionRun, persistAttempt } from "../lib/ingestion/repository.ts";
import { publishAdminFestivalChange } from "../lib/catalog/publication.ts";
import type { IngestionResult } from "../lib/ingestion/types.ts";
import sitemap from "../app/sitemap.ts";

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
    festivalEdition: {
      findMany: async () => {
        throw failure;
      },
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
  } finally {
    // Publication receipts are append-only; the unique fixture slug isolates reruns.
    await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
    await db.ingestionCandidate.deleteMany({ where: { runId: run.id } });
    await db.ingestionRun.delete({ where: { id: run.id } });
  }
});
