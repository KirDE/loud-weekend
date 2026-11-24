import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { collectArrivalCandidate } from "../../lib/ingestion/arrival-collector.ts";
import { inspectSource } from "../../lib/ingestion/agent-issues.ts";
import { claimDueSources, completeSourceLease } from "../../lib/ingestion/lease.ts";
import {
  createIngestionRun,
  finishIngestionRun,
  persistAttempt,
} from "../../lib/ingestion/repository.ts";
import { mapSource } from "../../lib/sources/repository.ts";

export async function stageArrivalFixture(
  db,
  festival,
  pages,
  { editionYear = 2027, primary } = {},
) {
  const edition = await db.festivalEdition.findUniqueOrThrow({
    where: { festivalId_year: { festivalId: festival.id, year: editionYear } },
  });
  const { slug } = festival;
  const url = primary ?? pages.keys().next().value;
  const now = new Date();
  const existing = await db.festivalSource.findUnique({
    where: { festivalSlug_url: { festivalSlug: slug, url } },
  });
  const row = existing
    ? await db.festivalSource.update({ where: { id: existing.id }, data: { nextRunAt: now } })
    : await db.festivalSource.create({
        data: {
          festivalId: festival.id,
          festivalSlug: slug,
          editionId: edition.id,
          editionYear,
          url,
          refreshPolicy: "weekly",
          strategies: ["manual_review"],
          enabled: true,
          cadenceSeconds: 604_800,
          parserKey: "manual_review",
          nextRunAt: now,
          configurationBackfilledAt: now,
        },
      });
  const owner = randomUUID();
  const leases = await claimDueSources(db, { owner, now, limit: 100, ttlMs: 60_000 });
  const lease = leases.find(({ id }) => id === row.id);
  assert.ok(lease, "arrival source is due");
  const sourceLease = { ...lease, owner };
  const run = await createIngestionRun(db, {
    trigger: "TEST",
    sourceCommit: "fixture",
    totalSources: 1,
  });
  const result = await collectArrivalCandidate(
    mapSource({ ...row, edition }),
    async (requestUrl, init) => {
      assert.equal(init.redirect, "error");
      assert.ok(pages.has(requestUrl), "only adapter-bound documents may be fetched");
      const response = new Response(pages.get(requestUrl), {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: requestUrl });
      return response;
    },
  );
  await persistAttempt(db, {
    runId: run.id,
    festivalSlug: slug,
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    durationMs: 1,
    startedAt: now,
    endedAt: new Date(),
    result,
    sourceLease,
  });
  await finishIngestionRun(db, run.id);
  for (const item of leases) {
    assert.equal(
      await completeSourceLease(db, { ...item, owner, now: new Date(), outcome: "success" }),
      true,
    );
  }
  const issue = await inspectSource(db, row.id);
  assert.ok(issue?.candidate?.arrivalFingerprint);
  return issue;
}
