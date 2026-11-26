import assert from "node:assert/strict";
import test from "node:test";
import { requestSourceRecheck, sourceRecheckInput } from "../lib/ingestion/source-recheck.ts";
const commit = "a".repeat(40);
const input = {
  operation: "source_recheck",
  sourceId: "source-1",
  editionId: "edition-1",
  editionYear: 2027,
  sourceUrl: "https://festival.example.test/",
  parserKey: "official_markup:tolminator",
  commit,
};
function fixture(patch = {}) {
  const source = {
    id: "source-1",
    enabled: true,
    deprecatedAt: null,
    configurationBackfilledAt: new Date(),
    editionId: "edition-1",
    editionYear: 2027,
    parserKey: input.parserKey,
    festivalId: "festival-1",
    festivalSlug: "tolminator",
    url: input.sourceUrl,
    strategies: ["official_markup"],
    consecutiveFailures: 0,
    lastError: null,
    leaseExpiresAt: null,
    edition: { year: 2027, recordState: "CURRENT", festivalId: "festival-1" },
    festival: {},
    ...patch,
  };
  const writes = [],
    receipts = new Map();
  let transactionOptions;
  const tx = {
    $queryRaw: async () => [],
    festivalSource: {
      findUnique: async () => source,
      update: async (x) => {
        writes.push(x);
        return source;
      },
    },
    ingestionAttempt: {
      findFirst: async () => ({
        status: "UNCHANGED",
        endedAt: new Date(),
        candidate: { warnings: [] },
      }),
    },
    operationalState: {
      findUnique: async ({ where }) => receipts.get(where.key),
      create: async ({ data }) => {
        receipts.set(data.key, data);
      },
    },
    adminAuditEntry: { create: async ({ data }) => writes.push({ audit: data }) },
  };
  const db = {
    $transaction: async (fn, options) => {
      transactionOptions = options;
      return fn(tx);
    },
  };
  return { db, source, writes, receipts, tx, options: () => transactionOptions };
}
process.env.DEPLOYED_COMMIT = commit;
test("a healthy source gets one audited due request, never publication or provider work", async () => {
  const f = fixture();
  const receipt = await requestSourceRecheck(f.db, input);
  assert.equal(receipt.requested, true);
  assert.equal(receipt.published, false);
  assert.equal(receipt.providerJobs, 0);
  assert.equal(f.writes.length, 2);
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), [
    "httpEtag",
    "httpLastModified",
    "nextRunAt",
  ]);
  assert.ok(f.writes[0].data.nextRunAt instanceof Date);
  assert.equal(f.writes[1].audit.resourceKey, "tolminator");
  assert.equal(f.options().isolationLevel, "Serializable");
  const replay = await requestSourceRecheck(f.db, input);
  assert.deepEqual(replay, receipt);
  assert.equal(f.writes.length, 2);
});
test("stale deployed commit is rejected before any database access", async () => {
  await assert.rejects(requestSourceRecheck({}, { ...input, commit: "b".repeat(40) }), {
    code: "stale",
  });
});
test("disabled, archived, wrong edition and wrong parser bindings fail closed", async () => {
  for (const patch of [
    { enabled: false },
    { deprecatedAt: new Date() },
    { configurationBackfilledAt: null },
    { editionId: "other" },
    { editionYear: 2026 },
    { parserKey: "other" },
    { url: "https://changed.example.test/" },
    { edition: { year: 2027, recordState: "ARCHIVED", festivalId: "festival-1" } },
    { edition: { year: 2026, recordState: "CURRENT", festivalId: "festival-1" } },
    { edition: { year: 2027, recordState: "CURRENT", festivalId: "other" } },
  ]) {
    const f = fixture(patch);
    await assert.rejects(requestSourceRecheck(f.db, input), { code: "stale" });
    assert.equal(f.writes.length, 0);
    assert.equal(f.receipts.size, 0);
  }
});
test("failure ladder and active importer leases cannot be bypassed", async () => {
  for (const patch of [
    { consecutiveFailures: 1 },
    { lastError: "network" },
    { leaseExpiresAt: new Date(Date.now() + 60000) },
  ]) {
    const f = fixture(patch);
    await assert.rejects(requestSourceRecheck(f.db, input), { code: "busy" });
    assert.equal(f.writes.length, 0);
  }
});
test("existing resolver case cannot be superseded by recheck", async () => {
  const f = fixture();
  f.tx.ingestionAttempt.findFirst = async () => ({
    status: "REVIEW",
    endedAt: new Date(),
    candidate: { reviewState: "PENDING", normalized: {}, warnings: [], evidence: [], diffs: [] },
  });
  f.source.edition.updatedAt = new Date();
  f.source.edition.lineup = [];
  f.source.edition.startDate = null;
  f.source.edition.endDate = null;
  f.source.edition.status = "PARTIAL";
  f.source.edition.completeness = "PARTIAL";
  f.source.edition.ticketStatus = "UNKNOWN";
  await assert.rejects(requestSourceRecheck(f.db, input), { code: "busy" });
  assert.equal(f.writes.length, 0);
});
test("IDs and payload shape cannot smuggle scope or URL/config changes", () => {
  for (const change of [
    { sourceId: "../other" },
    { editionId: "" },
    { url: "https://evil.test" },
    { commit: "short" },
  ])
    assert.equal(sourceRecheckInput.safeParse({ ...input, ...change }).success, false);
});
