import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { seedCatalog } from "./support/seed-catalog.ts";
import { catalogSeed } from "./support/catalog.ts";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { GET, POST } from "../app/api/ingestion/agent/route.ts";
import { claimDueSources } from "../lib/ingestion/lease.ts";
import { requestSourceRecheck } from "../lib/ingestion/source-recheck.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const commit = "a".repeat(40);
process.env.DEPLOYED_COMMIT = commit;
process.env.IMPORT_AGENT_SECRET = "synthetic-agent-source-recheck-secret".repeat(2);
const authorization = "Bearer " + process.env.IMPORT_AGENT_SECRET;
let input: {
  operation: "source_recheck";
  sourceId: string;
  editionId: string;
  editionYear: number;
  sourceUrl: string;
  parserKey: string;
  commit: string;
};
const request = (body: unknown, auth = true) =>
  new Request("https://app.test/api/ingestion/agent/", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
test.beforeEach(async () => {
  await seedCatalog(db, catalogSeed);
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: "synthetic-fest" } });
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festivalId: festival.id, recordState: "CURRENT" },
  });
  const source = await db.festivalSource.create({
    data: {
      festivalSlug: festival.slug,
      festivalId: festival.id,
      editionId: edition.id,
      editionYear: edition.year,
      url: "https://festival.example.test/" + randomUUID(),
      strategies: ["official_markup"],
      parserKey: "official_markup:synthetic",
      refreshPolicy: "daily",
      cadenceSeconds: 86400,
      configurationBackfilledAt: new Date(),
      nextRunAt: new Date(Date.now() + 86400000),
      httpEtag: "old-tag",
      httpLastModified: "old-date",
    },
  });
  input = {
    operation: "source_recheck",
    sourceId: source.id,
    editionId: edition.id,
    editionYear: edition.year,
    sourceUrl: source.url,
    parserKey: source.parserKey!,
    commit,
  };
});
test.after(async () => {
  await db.$disconnect();
});
test("protected exact-source lookup and recheck reject unauthenticated requests", async () => {
  assert.equal((await POST(request(input, false))).status, 401);
  assert.equal(
    (
      await GET(
        new Request("https://app.test/api/ingestion/agent/?mode=source&sourceId=" + input.sourceId),
      )
    ).status,
    401,
  );
  assert.equal((await POST(request({ ...input, url: "https://wrong.example" }))).status, 400);
  assert.equal((await POST(request({ ...input, commit: "b".repeat(40) }))).status, 409);
  const queried = await GET(
    new Request("https://app.test/api/ingestion/agent/?mode=source&sourceId=" + input.sourceId, {
      headers: { authorization },
    }),
  );
  assert.equal(queried.status, 200);
  assert.deepEqual(await queried.json(), { issue: null });
});
test("real transaction audits once; replay neither republishes nor advances next run", async () => {
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  const first = await POST(request(input));
  assert.equal(first.status, 200);
  const receipt = await first.json();
  assert.equal(receipt.published, false);
  assert.equal(receipt.providerJobs, 0);
  const saved = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  assert.ok(saved.nextRunAt! < before.nextRunAt!);
  assert.equal(saved.httpEtag, null);
  assert.equal(saved.httpLastModified, null);
  assert.equal(
    saved.configurationBackfilledAt?.toISOString(),
    before.configurationBackfilledAt?.toISOString(),
  );
  assert.equal(saved.consecutiveFailures, before.consecutiveFailures);
  const again = await POST(request(input));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), receipt);
  const replay = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  assert.equal(replay.nextRunAt?.toISOString(), saved.nextRunAt?.toISOString());
  assert.equal(
    await db.adminAuditEntry.count({
      where: {
        action: "ingestion.source.recheck_requested",
        metadata: { path: ["sourceId"], equals: input.sourceId },
      },
    }),
    1,
  );
});
test("source lease, failure and existing resolver case preserve scheduling and do not publish", async () => {
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  for (const patch of [
    { leaseExpiresAt: new Date(Date.now() + 60000) },
    { leaseExpiresAt: null, consecutiveFailures: 1 },
    { consecutiveFailures: 0, strategies: ["manual_review"] },
  ]) {
    await db.festivalSource.update({ where: { id: input.sourceId }, data: patch });
    assert.equal((await POST(request(input))).status, 409);
    assert.equal(
      (
        await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } })
      ).nextRunAt?.toISOString(),
      before.nextRunAt?.toISOString(),
    );
  }
});
test("concurrent requests have one durable receipt and cannot repeat source mutation", async () => {
  const results = await Promise.allSettled([
    requestSourceRecheck(db, input),
    requestSourceRecheck(db, input),
  ]);
  assert.ok(results.some((x) => x.status === "fulfilled"));
  const winner = results.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<unknown>;
  assert.deepEqual(await requestSourceRecheck(db, input), winner.value);
  assert.equal(
    await db.adminAuditEntry.count({
      where: {
        action: "ingestion.source.recheck_requested",
        metadata: { path: ["sourceId"], equals: input.sourceId },
      },
    }),
    1,
  );
});

test("unrunnable cadences cannot poison receipts; the normal worker claims a valid recheck", async () => {
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
  // The database itself rejects nonpositive integers; null is the permitted
  // unrunnable configuration that previously poisoned the successful receipt.
  for (const cadenceSeconds of [0, -1])
    await assert.rejects(
      db.festivalSource.update({ where: { id: input.sourceId }, data: { cadenceSeconds } }),
      /FestivalSource_cadenceSeconds_check/,
    );
  for (const cadenceSeconds of [null]) {
    await db.festivalSource.update({ where: { id: input.sourceId }, data: { cadenceSeconds } });
    assert.equal((await POST(request(input))).status, 409);
    const unchanged = await db.festivalSource.findUniqueOrThrow({ where: { id: input.sourceId } });
    assert.equal(unchanged.nextRunAt?.toISOString(), before.nextRunAt?.toISOString());
    assert.equal(unchanged.httpEtag, before.httpEtag);
    assert.equal(
      await db.operationalState.count({
        where: {
          key: { startsWith: "source-recheck-" },
          payload: { path: ["sourceId"], equals: input.sourceId },
        },
      }),
      0,
    );
  }
  await db.festivalSource.update({
    where: { id: input.sourceId },
    data: { cadenceSeconds: 86400 },
  });
  assert.equal((await POST(request(input))).status, 200);
  const claimed = await claimDueSources(db, {
    owner: randomUUID(),
    now: new Date(Date.now() + 1000),
    limit: 100,
    ttlMs: 60000,
  });
  assert.ok(claimed.some((row) => row.id === input.sourceId));
});
