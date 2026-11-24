import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { seedCatalog } from "./support/seed-catalog.ts";
import { catalogSeed } from "./support/catalog.ts";
import { collectTolminatorCandidate } from "../lib/ingestion/tolminator-stock-candidate.ts";
import { recordTolminatorStockAttempt } from "../lib/ingestion/tolminator-stock-invocation.ts";
import { TOLMINATOR_PRODUCT } from "../lib/ingestion/adapters/tolminator-stock.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import {
  createIngestionRun,
  persistAttempt,
  ingestionQueries,
} from "../lib/ingestion/repository.ts";
import { publishIngestionResult } from "../lib/catalog/publication.ts";
import { readCatalog } from "../lib/catalog/repository.ts";
import type { IngestionResult } from "../lib/ingestion/types.ts";

const fixture = readFileSync(
  new URL("./fixtures/ticket-status/tolminator-ordinary.html", import.meta.url),
  "utf8",
)
  .replace("2026-07-23T00:00:00+02:00", "2020-01-01T00:00:00Z")
  .replace('2027-07-31T00:00:00+02:00"}', '2099-01-01T00:00:00Z"}');
const sellerResponse =
  (html: string): typeof fetch =>
  async () => {
    const response = new Response(html, { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: TOLMINATOR_PRODUCT });
    return response;
  };
const fetchImpl = sellerResponse(fixture);
test("Tolminator publishes durable proof, rejects stale updates and preserves official dates", async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  let festivalId: string | undefined;
  const sourceCommit = "test-tolminator-stock";
  const read = async () =>
    (await readCatalog({ database: db })).festivals.find((f) => f.slug === "tolminator")!;
  const persist = async (value: IngestionResult) => {
    const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit, totalSources: 1 });
    return persistAttempt(db, {
      runId: run.id,
      festivalSlug: "tolminator",
      requestedUrl: value.sourceUrl,
      finalUrl: value.sourceUrl,
      httpStatus: 200,
      durationMs: 1,
      startedAt: new Date(),
      endedAt: new Date(),
      result: value,
    });
  };
  try {
    assert.equal(
      await db.festival.findUnique({ where: { slug: "tolminator" } }),
      null,
      "requires isolated fixture namespace",
    );
    const festival = {
      ...catalogSeed.festivals[0],
      slug: "tolminator",
      name: "Synthetic Tolminator",
      officialUrl: "https://tolminator.com/",
      editionYear: 2027,
      startDate: "2027-07-28",
      endDate: "2027-08-01",
      ticketStatus: "unknown" as const,
      ticketsUrl: undefined,
    };
    await seedCatalog(db, {
      ...catalogSeed,
      festivals: [...catalogSeed.festivals, festival],
      editions: [
        ...catalogSeed.editions,
        { ...festival, recordState: "current", completeness: "partial", provenance: [] },
      ],
    });
    const edition = await db.festivalEdition.findFirstOrThrow({
      where: { festival: { slug: "tolminator" }, year: 2027 },
    });
    festivalId = edition.festivalId;
    const before = await read();
    const jobs = await db.catalogPlaylistRefresh.count();
    const candidate = await collectTolminatorCandidate({ fetchImpl });
    assert.deepEqual(
      Object.keys(candidate).sort(),
      [
        "schemaVersion",
        "festivalSlug",
        "sourceUrl",
        "fetchedAt",
        "observedEditionYears",
        "warnings",
        "ticketStatus",
        "ticketsUrl",
        "evidence",
      ].sort(),
    );
    const value = evaluateCandidate(before, candidate);
    assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
    assert.ok(value.changes.length > 0);
    assert.ok(value.changes.every((c) => ["ticketStatus", "ticketsUrl"].includes(c.field)));
    const publish = (attemptId: string, result = value) =>
      publishIngestionResult(db, { attemptId, result, sourceCommit });
    const snapshot = async () => ({
      catalog: await read(),
      count: await db.catalogPublication.count(),
      jobs: await db.catalogPlaylistRefresh.count(),
    });
    // Real explicit invocation records evidence only, never publishes or
    // changes primary health. All responses here are synthetic, not live stock.
    const preInvocation = await snapshot();
    const primaryHealth = await db.ingestionSourceState.findUnique({
      where: { festivalSlug: "tolminator" },
    });
    const good = await recordTolminatorStockAttempt(db, {
      sourceCommit: "abcdef1234567",
      fetchImpl,
    });
    assert.notEqual(good.status, "FAILED");
    assert.equal(good.consecutiveFailures, 0);
    assert.ok(good.lastSuccessfulExtraction);
    assert.deepEqual(await snapshot(), preInvocation);
    assert.equal(
      (await ingestionQueries.latestResult(db, "tolminator", TOLMINATOR_PRODUCT))?.id,
      good.attemptId,
    );
    const failed = await recordTolminatorStockAttempt(db, {
      sourceCommit: "abcdef1234567",
      fetchImpl: async () => new Response("blocked", { status: 403 }),
    });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.error, "Tolminator HTTP 403");
    assert.equal(failed.consecutiveFailures, 1);
    assert.equal(failed.lastSuccessfulExtraction, good.lastSuccessfulExtraction);
    const failedRow = await db.ingestionAttempt.findUniqueOrThrow({
      where: { id: failed.attemptId },
      include: { candidate: true },
    });
    assert.equal(failedRow.httpStatus, 403);
    assert.equal(failedRow.candidate, null);
    assert.equal(
      (await db.ingestionRun.findUniqueOrThrow({ where: { id: failedRow.runId } })).status,
      "FAILED",
    );
    const unsafe = await recordTolminatorStockAttempt(db, {
      sourceCommit: "abcdef1234567",
      fetchImpl: async () => {
        throw new Error("https://private.invalid/?token=do-not-store");
      },
    });
    assert.equal(unsafe.error, "Tolminator stock collection failed");
    assert.equal(unsafe.consecutiveFailures, 2);
    assert.deepEqual(await snapshot(), preInvocation);
    assert.deepEqual(
      await db.ingestionSourceState.findUnique({ where: { festivalSlug: "tolminator" } }),
      primaryHealth,
    );
    const changedPrice = fixture
      .replaceAll("210 EUR", "225 EUR")
      .replaceAll('"210"', '"225"')
      .replace("210,00", "225,00");
    const changed = await recordTolminatorStockAttempt(db, {
      sourceCommit: "abcdef1234567",
      fetchImpl: sellerResponse(changedPrice),
    });
    assert.equal(changed.status, "PUBLISHABLE");
    const latest = await ingestionQueries.latestResult(db, "tolminator", TOLMINATOR_PRODUCT);
    assert.equal(latest?.id, changed.attemptId);
    assert.equal(latest?.candidate?.evidence.length, 2);
    assert.ok(latest.candidate.evidence.every((proof) => /225 EUR/.test(proof.excerpt ?? "")));
    const missing = await recordTolminatorStockAttempt(db, {
      sourceCommit: "abcdef1234567",
      fetchImpl: sellerResponse(
        changedPrice.replace('"availability": "In stock"', '"availability": "Unknown"'),
      ),
    });
    assert.equal(missing.status, "FAILED");
    assert.equal(
      (await ingestionQueries.latestResult(db, "tolminator", TOLMINATOR_PRODUCT))?.candidate,
      null,
    );
    assert.deepEqual(await snapshot(), preInvocation);
    const count = await db.ingestionRun.count();
    let fetched = false;
    await assert.rejects(
      recordTolminatorStockAttempt(db, {
        sourceCommit: "not-a-commit",
        fetchImpl: async () => {
          fetched = true;
          throw Error();
        },
      }),
      /commit/,
    );
    await db.festivalEdition.update({ where: { id: edition.id }, data: { year: 2028 } });
    await assert.rejects(
      recordTolminatorStockAttempt(db, {
        sourceCommit: "abcdef1234567",
        fetchImpl: async () => {
          fetched = true;
          throw Error();
        },
      }),
      /2027/,
    );
    assert.equal(fetched, false);
    assert.equal(await db.ingestionRun.count(), count);
    await db.festivalEdition.update({ where: { id: edition.id }, data: { year: 2027 } });
    const rejectedScope = /Tolminator|Ingestion publication scope does not match/;
    // Both the general persisted-scope fence and the product proof must fail atomically.
    for (const mutate of [
      (v: IngestionResult) => {
        v.candidate.sourceUrl = "https://foreign.example/";
      },
      (v: IngestionResult) => {
        v.candidate.festivalSlug = "other";
      },
      (v: IngestionResult) => {
        v.candidate.observedEditionYears = [2026];
      },
      (v: IngestionResult) => {
        v.candidate.startDate = "2027-07-31";
      },
      (v: IngestionResult) => {
        v.candidate.evidence = [];
      },
      (v: IngestionResult) => {
        v.festivalSlug = v.candidate.festivalSlug = "other";
        v.sourceUrl = v.candidate.sourceUrl = "https://foreign.example/";
      },
      (v: IngestionResult) => {
        v.candidate.ticketStatus = "sold_out";
      },
    ]) {
      const attempt = await persist(value),
        changed = structuredClone(value);
      mutate(changed);
      const before = await snapshot();
      await assert.rejects(publish(attempt.id, changed), rejectedScope);
      assert.deepEqual(await snapshot(), before);
    }
    for (const data of [
      { sourceUrl: "https://foreign.example/" },
      { observedValue: "sold_out" },
      { contentHash: "tampered" },
      { observedAt: new Date(0) },
    ]) {
      const attempt = await persist(value);
      await db.ingestionEvidence.updateMany({
        where: { candidate: { attemptId: attempt.id }, field: "ticketStatus" },
        data,
      });
      const before = await snapshot();
      await assert.rejects(publish(attempt.id), rejectedScope);
      assert.deepEqual(await snapshot(), before);
    }
    for (const data of [
      { httpStatus: 403 },
      { finalUrl: "https://foreign.example/" },
      { requestedUrl: "https://tolminator.com/" },
      { endedAt: new Date(0) },
    ]) {
      const attempt = await persist(value);
      await db.ingestionAttempt.update({ where: { id: attempt.id }, data });
      const before = await snapshot();
      await assert.rejects(publish(attempt.id), rejectedScope);
      assert.deepEqual(await snapshot(), before);
    }
    // Even matching caller/stored candidates cannot authorize seller-date or
    // stale observations. The protected path validates semantics independently.
    for (const kind of ["seller-date", "expired", "future", "year", "warning"]) {
      const changed = structuredClone(value);
      if (kind === "seller-date") changed.candidate.endDate = "2027-07-31";
      if (kind === "year") changed.candidate.observedEditionYears = [2026];
      if (kind === "warning") changed.candidate.warnings = ["unverified"];
      if (["expired", "future"].includes(kind)) {
        const time = new Date(
          Date.now() + (kind === "expired" ? -172800000 : 120000),
        ).toISOString();
        changed.fetchedAt = changed.candidate.fetchedAt = time;
        changed.candidate.evidence.forEach((e) => {
          e.observedAt = time;
        });
      }
      const attempt = await persist(changed),
        before = await snapshot();
      await assert.rejects(publish(attempt.id, changed), rejectedScope);
      assert.deepEqual(await snapshot(), before);
    }
    const attempt = await persist(value),
      publication = await publish(attempt.id);
    assert.ok(publication);
    assert.equal(publication.playlistRefreshRequested, false);
    assert.equal((await publish(attempt.id))?.id, publication.id);
    const after = await read();
    assert.equal(after.ticketStatus, "available");
    assert.equal(after.ticketsUrl, TOLMINATOR_PRODUCT);
    for (const key of ["startDate", "endDate", "officialUrl", "headliners", "lineup"] as const)
      assert.deepEqual(after[key], before[key]);
    assert.equal(after.endDate, "2027-08-01");
    assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
    const saved = await db.ingestionEvidence.findMany({
      where: { candidate: { attemptId: attempt.id } },
    });
    assert.equal(saved.length, 2);
    assert.ok(
      saved.every((e) =>
        (publication.evidence as { evidenceIds: string[] }).evidenceIds.includes(e.id),
      ),
    );
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: { ticketStatus: "UNKNOWN", ticketsUrl: null },
    });
    const stale = evaluateCandidate(await read(), candidate),
      staleAttempt = await persist(stale);
    await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: "LOW" } });
    const preStale = await snapshot();
    await assert.rejects(publish(staleAttempt.id, stale), /Stale ticketStatus/);
    assert.deepEqual(await snapshot(), preStale);

    // Regression: the existing primary homepage adapter may fill missing dates
    // without satisfying the unrelated seller's ticket-only contract.
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: { startDate: null, endDate: null },
    });
    const primaryBefore = await read();
    const primary = extractFestivalCandidate(
      readFileSync(new URL("./fixtures/official-markup/tolminator.html", import.meta.url), "utf8"),
      parserSource("tolminator", { url: "https://tolminator.com/" }),
      new Date().toISOString(),
    );
    const primaryValue = evaluateCandidate(primaryBefore, primary);
    assert.equal(primaryValue.publishable, true, JSON.stringify(primaryValue.reviewReasons));
    assert.deepEqual(primaryValue.changes.map((c) => c.field).sort(), ["endDate", "startDate"]);
    const primaryAttempt = await persist(primaryValue);
    const primaryPublication = await publish(primaryAttempt.id, primaryValue);
    assert.ok(primaryPublication);
    assert.equal(primaryPublication.playlistRefreshRequested, false);
    const primaryAfter = await read();
    assert.equal(primaryAfter.startDate, "2027-07-28");
    assert.equal(primaryAfter.endDate, "2027-08-01");
    for (const key of ["ticketStatus", "ticketsUrl", "lineup", "headliners"] as const)
      assert.deepEqual(primaryAfter[key], primaryBefore[key]);
    assert.equal((await publish(primaryAttempt.id, primaryValue))?.id, primaryPublication.id);
    assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
  } finally {
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    await db.$disconnect();
  }
});
