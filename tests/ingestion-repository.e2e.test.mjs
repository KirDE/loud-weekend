import { TOLMINATOR_PRODUCT } from "../lib/ingestion/adapters/tolminator-stock.ts";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import { ROSKILDE_PRODUCTS_URL } from "../lib/ingestion/adapters/roskilde-stock.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  createIngestionRun,
  finishIngestionRun,
  ingestionQueries,
  persistAttempt,
} from "../lib/ingestion/repository.ts";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for ingestion repository E2E tests");
const db = createPrismaClient();
const suffix = `${Date.now()}-${process.pid}`;
const slug = `repository-e2e-${suffix}`;
const now = new Date();
let runId;
const createdRunIds = [];

async function cleanup() {
  if (!createdRunIds.length) return;
  const candidates = await db.ingestionCandidate.findMany({
    where: { runId: { in: createdRunIds } },
    select: { id: true },
  });
  const candidateIds = candidates.map(({ id }) => id);
  await db.ingestionDiff.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await db.ingestionEvidence.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await db.ingestionCandidate.deleteMany({ where: { id: { in: candidateIds } } });
  await db.ingestionAttempt.deleteMany({ where: { runId: { in: createdRunIds } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
}

after(async () => {
  await cleanup();
  await db.$disconnect();
});

const result = (startDate, publishable = false, reviewReasons = []) => ({
  schemaVersion: 1,
  festivalSlug: slug,
  sourceUrl: "https://example.test/festival",
  fetchedAt: now.toISOString(),
  changes: [
    {
      kind: "date_changed",
      field: "startDate",
      before: "2027-06-01",
      after: startDate,
      reviewRequired: reviewReasons.length > 0,
    },
  ],
  candidate: {
    schemaVersion: 1,
    festivalSlug: slug,
    sourceUrl: "https://example.test/festival",
    fetchedAt: now.toISOString(),
    startDate,
    evidence: [
      {
        field: "startDate",
        sourceUrl: "https://example.test/festival",
        observedAt: now.toISOString(),
        excerpt: `date ${startDate}`,
      },
    ],
    warnings: [],
  },
  publishable,
  reviewReasons,
});

test("persists partial failure, retry lineage and immutable candidate history", async () => {
  const run = await createIngestionRun(db, {
    trigger: "TEST",
    sourceCommit: "e2e",
    totalSources: 2,
  });
  runId = run.id;
  createdRunIds.push(run.id);
  const failed = await persistAttempt(db, {
    runId,
    festivalSlug: slug,
    requestedUrl: "https://example.test/festival",
    durationMs: 5,
    startedAt: now,
    endedAt: now,
    error: "HTTP 503",
  });
  const retried = await persistAttempt(db, {
    runId,
    festivalSlug: slug,
    requestedUrl: "https://example.test/festival",
    finalUrl: "https://example.test/festival",
    httpStatus: 200,
    durationMs: 8,
    retryCount: 1,
    startedAt: now,
    endedAt: new Date(now.getTime() + 1_000),
    result: result("2027-06-02", false, ["date requires review"]),
  });
  assert.equal(retried.priorAttemptId, failed.id);
  const finished = await finishIngestionRun(db, runId);
  assert.equal(finished.status, "PARTIAL");
  assert.equal(finished.failed, 1);
  assert.equal(finished.successful, 1);

  const nextRun = await createIngestionRun(db, {
    trigger: "TEST",
    sourceCommit: "e2e-2",
    totalSources: 1,
  });
  createdRunIds.push(nextRun.id);
  const second = await persistAttempt(db, {
    runId: nextRun.id,
    festivalSlug: slug,
    requestedUrl: "https://example.test/festival",
    httpStatus: 200,
    durationMs: 4,
    startedAt: now,
    endedAt: new Date(now.getTime() + 2_000),
    result: result("2027-06-03", true),
  });
  await finishIngestionRun(db, nextRun.id);

  const latest = await ingestionQueries.latestResult(db, slug);
  const candidates = await ingestionQueries.candidateHistory(db, slug);
  const diffs = await ingestionQueries.diffHistory(db, slug);
  const runs = await ingestionQueries.runHistory(db, 10);
  const states = await ingestionQueries.sourceStates(db);
  assert.equal(latest.id, second.id);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].supersedesId, candidates[1].id);
  assert.equal(diffs.length, 2);
  assert.ok(runs.some(({ id }) => id === runId));
  assert.equal(
    states.find((state) => state.festivalSlug === slug).lastSuccessfulCheck.toISOString(),
    new Date(now.getTime() + 2_000).toISOString(),
  );
});

for (const stockUrl of [TOLMINATOR_PRODUCT, ROSKILDE_PRODUCTS_URL]) {
  test(`independent stock cannot reset primary health or lineage: ${stockUrl}`, async () => {
    const run = await createIngestionRun(db, {
      trigger: "TEST",
      sourceCommit: "health-isolation",
      totalSources: 2,
    });
    createdRunIds.push(run.id);
    const primaryUrl = "https://example.test/festival";
    let tick = 10;
    const save = (url, value, festivalSlug = slug) =>
      persistAttempt(db, {
        runId: run.id,
        festivalSlug,
        requestedUrl: url,
        finalUrl: url,
        httpStatus: value ? 200 : 403,
        durationMs: 1,
        startedAt: now,
        endedAt: new Date(now.getTime() + tick++ * 1000),
        ...(value ? { result: value } : { error: "HTTP 403" }),
      });
    const slug = new URL(stockUrl).hostname + "-health-proof";
    const primarySeed = result("2027-06-04", true);
    primarySeed.festivalSlug = primarySeed.candidate.festivalSlug = slug;
    primarySeed.sourceUrl = primarySeed.candidate.sourceUrl = primaryUrl;
    await save(primaryUrl, primarySeed);
    const primary = await ingestionQueries.latestResult(db, slug);
    const health = (await ingestionQueries.sourceStates(db)).find((s) => s.festivalSlug === slug);
    const extraction = await ingestionQueries.lastSuccessfulExtraction(db, slug);
    const failure = await save(primaryUrl);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug), 1);
    const value = result("2027-06-04", true);
    value.festivalSlug = value.candidate.festivalSlug = slug;
    value.sourceUrl = value.candidate.sourceUrl = stockUrl;
    value.candidate.evidence = [
      {
        field: "ticketStatus",
        sourceUrl: stockUrl,
        observedAt: new Date(now.getTime() + 9000).toISOString(),
        excerpt: "Synthetic current ordinary stock",
      },
    ];
    value.candidate.ticketStatus = "available";
    const stock = await save(stockUrl, value);
    assert.equal(stock.priorAttemptId, null, "primary attempt is not a stock predecessor");
    const stockCandidate = await db.ingestionCandidate.findUnique({
      where: { attemptId: stock.id },
    });
    assert.equal(stockCandidate.supersedesId, null, "stock does not supersede roster candidate");
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug), 1);
    assert.equal((await ingestionQueries.latestResult(db, slug)).id, failure.id);
    assert.deepEqual(
      (await ingestionQueries.sourceStates(db)).find((s) => s.festivalSlug === slug),
      health,
    );
    assert.deepEqual(await ingestionQueries.lastSuccessfulExtraction(db, slug), extraction);
    assert.equal((await ingestionQueries.latestResult(db, slug, stockUrl)).id, stock.id);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug, stockUrl), 0);
    assert.equal(
      (
        await ingestionQueries.lastSuccessfulExtraction(db, slug, stockUrl)
      ).observedAt.toISOString(),
      value.candidate.evidence[0].observedAt,
    );
    const stockFailure = await save(stockUrl);
    assert.equal(stockFailure.priorAttemptId, stock.id);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug, stockUrl), 1);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug), 1);
    const failure2 = await save(primaryUrl);
    assert.equal(failure2.priorAttemptId, failure.id);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug), 2);
    const recovery = await save(primaryUrl, primarySeed);
    assert.equal(recovery.priorAttemptId, failure2.id);
    const recoveredCandidate = await db.ingestionCandidate.findUnique({
      where: { attemptId: recovery.id },
    });
    assert.equal(recoveredCandidate.supersedesId, primary.candidate.id);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug), 0);
    assert.equal(
      await ingestionQueries.consecutiveFailures(db, slug, stockUrl),
      1,
      "primary recovery does not heal failed stock",
    );
    const primaryFailure = await save(primaryUrl);
    const recoveryHealth = (await ingestionQueries.sourceStates(db)).find(
      (s) => s.festivalSlug === slug,
    );
    const stockRecovery = await save(stockUrl, value);
    assert.equal(stockRecovery.priorAttemptId, stockFailure.id);
    const stockRecoveryCandidate = await db.ingestionCandidate.findUnique({
      where: { attemptId: stockRecovery.id },
    });
    assert.equal(stockRecoveryCandidate.supersedesId, stockCandidate.id);
    assert.equal(await ingestionQueries.consecutiveFailures(db, slug, stockUrl), 0);
    assert.equal(
      await ingestionQueries.consecutiveFailures(db, slug),
      1,
      "stock recovery cannot heal failed primary",
    );
    assert.equal((await ingestionQueries.latestResult(db, slug)).id, primaryFailure.id);
    assert.deepEqual(
      (await ingestionQueries.sourceStates(db)).find((s) => s.festivalSlug === slug),
      recoveryHealth,
    );
    const isolatedSlug = `${slug}-stock-only`;
    const isolated = structuredClone(value);
    isolated.festivalSlug = isolated.candidate.festivalSlug = isolatedSlug;
    await save(stockUrl, isolated, isolatedSlug);
    assert.equal(
      await db.ingestionSourceState.findUnique({ where: { festivalSlug: isolatedSlug } }),
      null,
      "stock cannot create primary health",
    );
    assert.equal(await ingestionQueries.latestResult(db, isolatedSlug), null);
    assert.equal(await ingestionQueries.lastSuccessfulExtraction(db, isolatedSlug), null);
    assert.equal(await ingestionQueries.consecutiveFailures(db, isolatedSlug), 0);
    assert.ok(await ingestionQueries.latestResult(db, isolatedSlug, stockUrl));
  });
}
