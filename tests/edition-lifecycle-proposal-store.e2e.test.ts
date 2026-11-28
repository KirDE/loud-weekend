import sitemap from "../app/sitemap.ts";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import {
  stageEditionLifecycle as stage,
  readPendingEditionLifecycle as read,
  decideEditionLifecycle as decide,
  readApprovedEditionLifecycle as publicRead,
} from "../lib/ingestion/edition-lifecycle-proposal-store.ts";
import { readArrivalFacts } from "../lib/catalog/arrival-facts.ts";
import { DatabaseCatalogRepository } from "../lib/catalog/repository.ts";
import { readSocialPreview } from "../lib/catalog/social-preview.ts";
import { formatFestivalDateRange } from "../lib/festival-dates.ts";
import { readOfflineCatalog, serveOfflineCatalog } from "../lib/catalog/offline.ts";
import { readPublishedOfflineTrip } from "../lib/catalog/offline-trip.ts";
import { issueCalendarKey, readCalendarFeed } from "../lib/calendar-subscription.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const html = readFileSync(new URL("./fixtures/rock-en-seine/hiatus.html", import.meta.url), "utf8");
const url = "https://www.rockenseine.com/";
const slug = "rock-en-seine";
let editionId: string;
let festivalId: string;
let artistId: string;
const time = Date.now() - 10_000;
const input = (delta = 0) => ({
  parserVersion: "rock-en-seine-hiatus-v1",
  editionId,
  html,
  requestedUrl: url,
  finalUrl: url,
  status: 200,
  observedAt: new Date(time + delta).toISOString(),
});
test.before(async () => {
  assert.equal(
    await db.festival.count({ where: { slug } }),
    0,
    "Requires isolated disposable DB without Rock en Seine",
  );
  const f = await db.festival.create({
    data: {
      slug,
      name: "Synthetic Rock en Seine",
      country: "France",
      countryCode: "FR",
      officialUrl: url,
      genres: [],
    },
  });
  festivalId = f.id;
  artistId = (
    await db.artist.create({
      data: {
        slug: "lifecycle-synthetic-artist",
        name: "Lifecycle Synthetic Artist",
        aliases: [],
        genres: [],
        identityState: "UNRESOLVED",
        topTracks: [],
        recentSetlists: [],
        freshness: {},
      },
    })
  ).id;
  editionId = (
    await db.festivalEdition.create({
      data: {
        festivalId,
        year: 2027,
        status: "CONFIRMED",
        ticketStatus: "UNKNOWN",
        recordState: "CURRENT",
        completeness: "COMPLETE",
        sourceUpdatedAt: new Date(time),
        startDate: new Date("2027-08-25"),
        endDate: new Date("2027-08-29"),
      },
    })
  ).id;
  await db.lineupEntry.create({ data: { editionId, artistId, billing: "HEADLINER", position: 0 } });
});
test.after(async () => {
  if (editionId)
    await db.editionLifecycleReviewDecision.deleteMany({ where: { snapshot: { editionId } } });
  if (festivalId) await db.festival.deleteMany({ where: { id: festivalId } });
  if (artistId) await db.artist.delete({ where: { id: artistId } });
  await db.$disconnect();
});
test("absent lifecycle evidence is not a confirmed active edition", async () => {
  assert.equal(await read(db, editionId), null);
  assert.equal(await publicRead(db, editionId), null);
  const catalog = await new DatabaseCatalogRepository(db).read();
  assert.equal(catalog.festivals.find((f) => f.slug === slug)!.editionLifecycle, undefined);
  assert.ok(catalog.artists.some((a) => a.name === "Lifecycle Synthetic Artist"));
  assert.ok((await readOfflineCatalog(db)).festivals.some((f) => f.slug === slug));
});
test("durable pending evidence/read/replay has NO catalogue, health, provider or notification effects", async () => {
  const before = await db.festivalEdition.findMany();
  const counts = async () =>
    Promise.all([
      db.catalogPublication.count(),
      db.catalogPlaylistRefresh.count(),
      db.ingestionNotificationOutbox.count(),
      db.ingestionSourceState.count(),
    ]);
  const priorCounts = await counts();
  const row = await stage(db, input());
  const pending = await read(db, editionId);
  assert.equal(pending!.id, row.id);
  assert.equal(pending!.reviewState, "pending");
  assert.equal(pending!.eligibleForReview, true);
  assert.equal(pending!.proposal.lifecycle, "hiatus");
  assert.equal(pending!.proposal.announcedReturnYear, 2028);
  assert.equal(pending!.proposal.alternativeEvent, "under_consideration");
  assert.equal(await publicRead(db, editionId), null);
  assert.ok(
    (await readOfflineCatalog(db)).festivals.some((f) => f.slug === slug),
    "Pending is not approved hiatus",
  );
  assert.equal(
    (await new DatabaseCatalogRepository(db).read()).festivals.find((f) => f.slug === slug)!
      .editionLifecycle,
    undefined,
  );
  assert.equal((await stage(db, input())).id, row.id);
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 1);
  assert.deepEqual(await db.festivalEdition.findMany(), before); // also no 2028 auto-creation
  assert.deepEqual(await counts(), priorCounts);
  assert.doesNotMatch(
    JSON.stringify(row.proposal),
    /<html|ticketStatus|startDate|endDate|cookies|session/,
  );
});
test("bad transport/notice/clock/target rejected without partial stage", async () => {
  for (const change of [
    { status: 403 },
    { status: 206 },
    { requestedUrl: url + "?x=1" },
    { finalUrl: "https://other.invalid/" },
    { html: html.replaceAll("2027", "2026") },
    { html: html.replace("une pause", "un festival") },
    { html: "" },
    { observedAt: new Date(time - 86_400_001).toISOString() },
    { observedAt: new Date(Date.now() + 120_000).toISOString() },
    { observedAt: new Date(time - 1).toISOString() },
    { editionId: "absent" },
  ])
    await assert.rejects(stage(db, { ...input(), ...change }));
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 1);
});
test("concurrent first/newer replay is serialized, historical snapshots retained", async () => {
  // Independent empty history for the same reviewed identity, after retaining first row locally.
  const first = await db.editionLifecycleProposalSnapshot.findFirstOrThrow();
  await db.editionLifecycleProposalSnapshot.delete({ where: { id: first.id } });
  const rows = await Promise.all([stage(db, input()), stage(db, input())]);
  assert.equal(rows[0].id, rows[1].id);
  const newer = await Promise.all([stage(db, input(1)), stage(db, input(1))]);
  assert.equal(newer[0].id, newer[1].id);
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 2);
  assert.equal((await read(db, editionId))!.id, newer[0].id);
});
test("persisted evidence drift fails read AND new staging without older healthy fallback", async () => {
  const row = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
    orderBy: { observedAt: "desc" },
  });
  for (const patch of [
    { sourceUrl: "https://other.invalid/" },
    { finalUrl: url + "archive/" },
    { httpStatus: 403 },
    { contentHash: "0".repeat(64) },
    { parserVersion: "unknown" },
    { observedAt: new Date(time + 2) },
    { proposal: { ...(row.proposal as object), ticketStatus: "available" } },
    { proposal: { ...(row.proposal as object), lifecycle: "active" } },
    { proposal: { ...(row.proposal as object), announcedReturnYear: 2029 } },
    { proposal: { ...(row.proposal as object), excerpt: "forged assertion" } },
  ]) {
    await db.editionLifecycleProposalSnapshot.update({ where: { id: row.id }, data: patch });
    await assert.rejects(read(db, editionId));
    await assert.rejects(publicRead(db, editionId));
    await assert.rejects(stage(db, input(100)));
    await db.editionLifecycleProposalSnapshot.update({
      where: { id: row.id },
      data: {
        sourceUrl: row.sourceUrl,
        finalUrl: row.finalUrl,
        httpStatus: row.httpStatus,
        contentHash: row.contentHash,
        parserVersion: row.parserVersion,
        observedAt: row.observedAt,
        proposal: row.proposal!,
      },
    });
  }
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 2);
});
test("source and edition rebinding cannot authorize evidence", async () => {
  for (const patch of [{ slug: "other" }, { officialUrl: "https://other.invalid/" }]) {
    await db.festival.update({ where: { id: festivalId }, data: patch });
    await assert.rejects(read(db, editionId));
    await assert.rejects(publicRead(db, editionId));
    await assert.rejects(stage(db, input(100)));
    await db.festival.update({ where: { id: festivalId }, data: { slug, officialUrl: url } });
  }
  for (const patch of [{ year: 2028 }, { recordState: "ARCHIVED" as const }]) {
    await db.festivalEdition.update({ where: { id: editionId }, data: patch });
    await assert.rejects(read(db, editionId));
    await assert.rejects(publicRead(db, editionId));
    await assert.rejects(stage(db, input(100)));
    await db.festivalEdition.update({
      where: { id: editionId },
      data: { year: 2027, recordState: "CURRENT" },
    });
  }
});
test("valid but expired evidence stays historical pending, NOT eligible for review", async () => {
  const now = Date.now;
  try {
    Date.now = () => time + 86_400_003;
    const pending = await read(db, editionId);
    assert.equal(pending!.reviewState, "pending");
    assert.equal(pending!.eligibleForReview, false);
    await assert.rejects(stage(db, input(2)));
  } finally {
    Date.now = now;
  }
});

let actorId: string;
let originalAllowlist: string | undefined;
let reviewed: Awaited<ReturnType<typeof stage>>;
const email = "lifecycle-review-fixture@example.invalid";
const sitemapDates = async () =>
  Object.fromEntries(
    (await sitemap()).map(({ url, lastModified }) => [new URL(url).pathname, lastModified]),
  );
const decisionInput = () => ({
  snapshotId: reviewed.id,
  expectedContentHash: reviewed.contentHash,
  decision: "approve" as const,
  actorId,
});
test("review rejects untrusted actors, revoked role, missing allowlist and wrong revision without writes", async () => {
  originalAllowlist = process.env.ADMIN_EMAILS;
  const actor = await db.user.upsert({
    where: { email },
    create: { email, role: "EDITOR" },
    update: { role: "EDITOR" },
  });
  actorId = actor.id;
  process.env.ADMIN_EMAILS = email;
  reviewed = await stage(db, input(100));
  const n = await db.adminAuditEntry.count();
  await assert.rejects(decide(db, { ...decisionInput(), actorId: "absent" }));
  await assert.rejects(decide(db, { ...decisionInput(), expectedContentHash: "0".repeat(64) }));
  await assert.rejects(decide(db, { ...decisionInput(), decision: "activate" as "approve" }));
  process.env.ADMIN_EMAILS = "";
  await assert.rejects(decide(db, decisionInput()));
  process.env.ADMIN_EMAILS = email;
  await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
  await assert.rejects(decide(db, decisionInput()));
  await db.user.update({ where: { id: actorId }, data: { role: "EDITOR" } });
  assert.equal(await db.adminAuditEntry.count(), n);
  assert.equal(await db.editionLifecycleReviewDecision.count(), 0);
});
test("superseded and expired lifecycle cannot be approved", async () => {
  const old = decisionInput();
  reviewed = await stage(db, input(101));
  await assert.rejects(decide(db, old));
  const now = Date.now;
  try {
    Date.now = () => time + 86_400_200;
    await assert.rejects(decide(db, decisionInput()));
  } finally {
    Date.now = now;
  }
  assert.equal(await db.editionLifecycleReviewDecision.count(), 0);
});
test("decision revalidates current target and persisted evidence before any audit", async () => {
  const n = await db.adminAuditEntry.count();
  await db.festival.update({
    where: { id: festivalId },
    data: { officialUrl: "https://other.invalid/" },
  });
  try {
    await assert.rejects(decide(db, decisionInput()));
  } finally {
    await db.festival.update({ where: { id: festivalId }, data: { officialUrl: url } });
  }
  await db.festivalEdition.update({ where: { id: editionId }, data: { recordState: "ARCHIVED" } });
  try {
    await assert.rejects(decide(db, decisionInput()));
  } finally {
    await db.festivalEdition.update({ where: { id: editionId }, data: { recordState: "CURRENT" } });
  }
  await db.editionLifecycleProposalSnapshot.update({
    where: { id: reviewed.id },
    data: { httpStatus: 403 },
  });
  try {
    await assert.rejects(decide(db, decisionInput()));
  } finally {
    await db.editionLifecycleProposalSnapshot.update({
      where: { id: reviewed.id },
      data: { httpStatus: 200 },
    });
  }
  assert.equal(await db.adminAuditEntry.count(), n);
});
test("decision insert failure rolls back audit atomically", async () => {
  const n = await db.adminAuditEntry.count();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION lifecycle_test_fail() RETURNS trigger LANGUAGE ` +
      `plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic decision failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER lifecycle_test_fail BEFORE INSERT ON ` +
      `"EditionLifecycleReviewDecision" FOR EACH ROW EXECUTE FUNCTION lifecycle_test_fail()`,
  );
  try {
    await assert.rejects(decide(db, decisionInput()));
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER lifecycle_test_fail ON "EditionLifecycleReviewDecision"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION lifecycle_test_fail()`);
  }
  assert.equal(await db.adminAuditEntry.count(), n);
  assert.equal(await db.editionLifecycleReviewDecision.count(), 0);
});
test("concurrent exact-revision decisions replay once with immutable audit and NO canonical effects", async () => {
  const previousDay = new Date(time - 86_400_000);
  await db.catalogPublication.create({
    data: {
      source: "ADMIN",
      sourceId: "lifecycle-sitemap-fixture",
      festivalSlug: slug,
      editionYear: 2027,
      actorLabel: "fixture",
      fields: ["name", "city"],
      createdAt: previousDay,
    },
  });
  const pendingDates = await sitemapDates();
  const prefixes = ["", "/en", "/de", "/ru"];
  const homePaths = prefixes.map((prefix) => `${prefix}/`);
  const dossierPaths = prefixes.map((prefix) => `${prefix}/festivals/${slug}/`);
  for (const path of dossierPaths) assert.equal(pendingDates[path], previousDay.toISOString());

  const arrival = await db.editionArrivalFact.create({
    data: {
      editionId,
      editionYear: 2027,
      organizerHost: "rockenseine.com",
      countryCode: "FR",
      kind: "shuttle",
      descriptionEn: "Fixture shuttle",
      descriptionDe: "Test-Shuttle",
      descriptionRu: "Тестовый шаттл",
      sourceUrl: url + "test-arrival-guide/",
      checkedOn: previousDay,
    },
  });
  const readBothArrivalViews = async () => {
    const { editions, festivals } = await new DatabaseCatalogRepository(db).read();
    const series = festivals.find((item) => item.slug === slug);
    const edition = editions.find((item) => item.slug === slug && item.editionYear === 2027);
    assert.ok(series && edition);
    return Promise.all([readArrivalFacts(db, series), readArrivalFacts(db, edition)]);
  };
  for (const guidance of await readBothArrivalViews()) {
    assert.deepEqual(
      guidance.map(({ sourceUrl }) => sourceUrl),
      [arrival.sourceUrl],
    );
  }

  const before = await db.festivalEdition.findMany();
  const n = await db.adminAuditEntry.count();
  const rows = await Promise.all([decide(db, decisionInput()), decide(db, decisionInput())]);
  assert.equal(rows[0].id, rows[1].id);
  assert.equal(await db.adminAuditEntry.count(), n + 1);
  assert.equal(rows[0].audit.actorId, actorId);
  assert.equal(rows[0].audit.actorLabel, actorId);
  assert.deepEqual(await readBothArrivalViews(), [[], []]);
  assert.deepEqual(
    await db.editionArrivalFact.findUnique({
      where: { editionId_kind: { editionId, kind: arrival.kind } },
    }),
    arrival,
  );
  const approvalDate = rows[0].audit.createdAt.toISOString();
  const approvedSitemapDates = await sitemapDates();
  // Earlier integration tests may have published newer facts for another festival.
  for (const path of [...homePaths, ...dossierPaths, "/countries/fr/"]) {
    const baseline = pendingDates[path];
    assert.ok(
      typeof baseline === "string" && baseline < approvalDate,
      `Expected an older baseline for ${path}`,
    );
    assert.equal(approvedSitemapDates[path], approvalDate);
  }
  for (const path of [`/festivals/${slug}/2027/`, "/editions/2027/"]) {
    assert.ok(Object.hasOwn(pendingDates, path), `Missing control entry ${path}`);
    assert.equal(approvedSitemapDates[path], pendingDates[path]);
  }
  assert.equal((await decide(db, decisionInput())).id, rows[0].id);
  assert.deepEqual(await sitemapDates(), approvedSitemapDates);
  assert.equal((await read(db, editionId))!.reviewState, "approved");
  assert.equal((await read(db, editionId))!.eligibleForReview, false);
  await assert.rejects(
    db.adminAuditEntry.update({ where: { id: rows[0].auditId }, data: { action: "FORGED" } }),
  );
  await assert.rejects(db.adminAuditEntry.delete({ where: { id: rows[0].auditId } }));
  await assert.rejects(decide(db, { ...decisionInput(), decision: "reject" }));
  await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
  await assert.rejects(decide(db, decisionInput())); // replay also rechecks role
  await db.user.update({ where: { id: actorId }, data: { role: "EDITOR" } });
  assert.deepEqual(await db.festivalEdition.findMany(), before);
});

test("a subscribed calendar drops only the approved hiatus without clearing attendance", async () => {
  const user = await db.user.create({ data: { email: "lifecycle-calendar@example.invalid" } });
  const other = await db.festival.create({
    data: {
      slug: "lifecycle-calendar-control",
      name: "Calendar Control",
      country: "France",
      countryCode: "FR",
      officialUrl: "https://example.invalid/",
      genres: [],
      editions: {
        create: {
          year: 2027,
          recordState: "CURRENT",
          status: "CONFIRMED",
          ticketStatus: "UNKNOWN",
          completeness: "COMPLETE",
          sourceUpdatedAt: new Date(time),
          startDate: new Date("2027-07-01"),
        },
      },
    },
  });
  try {
    const plans = await db.syncDocument.create({
      data: {
        userId: user.id,
        kind: "FESTIVAL_PLANS",
        payload: { attendance: { [slug]: "going", [other.slug]: "maybe" } },
      },
    });
    const key = await issueCalendarKey(db, user.id);
    assert.ok(key);
    const feed = await readCalendarFeed(db, key);
    assert.ok(feed);
    assert.match(feed, /SUMMARY:Calendar Control/);
    assert.doesNotMatch(feed, /Synthetic Rock en Seine|DTSTART;VALUE=DATE:20270825/);
    assert.deepEqual(await db.syncDocument.findUniqueOrThrow({ where: { id: plans.id } }), plans);
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.festival.delete({ where: { id: other.id } });
  }
});

test("stored decision or snapshot drift fails read and replay instead of fabricating approval", async () => {
  const row = await db.editionLifecycleReviewDecision.findUniqueOrThrow({
    where: { snapshotId: reviewed.id },
  });
  for (const patch of [{ decision: "reject" }, { contentHash: "0".repeat(64) }]) {
    await db.editionLifecycleReviewDecision.update({ where: { id: row.id }, data: patch });
    await assert.rejects(read(db, editionId));
    await assert.rejects(publicRead(db, editionId));
    await assert.rejects(decide(db, decisionInput()));
    await db.editionLifecycleReviewDecision.update({
      where: { id: row.id },
      data: { decision: row.decision, contentHash: row.contentHash },
    });
  }
  await db.editionLifecycleProposalSnapshot.update({
    where: { id: reviewed.id },
    data: { contentHash: "0".repeat(64) },
  });
  await assert.rejects(read(db, editionId));
  await assert.rejects(publicRead(db, editionId));
  await assert.rejects(decide(db, decisionInput()));
  await db.editionLifecycleProposalSnapshot.update({
    where: { id: reviewed.id },
    data: { contentHash: reviewed.contentHash },
  });
});
test("new rejected observation does not silently inherit previous approval", async () => {
  const approved = await publicRead(db, editionId);
  assert.ok(approved);
  assert.equal(approved.lifecycle, "hiatus");
  assert.deepEqual(
    Object.keys(approved).sort(),
    [
      "festivalSlug",
      "editionYear",
      "lifecycle",
      "announcedReturnYear",
      "alternativeEvent",
      "sourceUrl",
      "observedAt",
      "approvedAt",
    ].sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(approved),
    /actor|audit|contentHash|snapshotId|eligible|reviewState|ticketStatus|startDate|endDate|excerpt/,
  );
  const now = Date.now;
  try {
    Date.now = () => time + 90_000_000;
    assert.deepEqual(
      await publicRead(db, editionId),
      approved,
      "Historical approved fact retains original times, no fresh stock assertion",
    );
  } finally {
    Date.now = now;
  }
  const approvedSitemapDates = await sitemapDates();
  reviewed = await stage(db, input(102));
  assert.deepEqual(
    await publicRead(db, editionId),
    approved,
    "New pending does not inherit approval or restamp previous notice",
  );
  assert.equal((await read(db, editionId))!.reviewState, "pending");
  assert.deepEqual(await sitemapDates(), approvedSitemapDates);
  const rejected = await decide(db, { ...decisionInput(), decision: "reject" });
  assert.deepEqual(await sitemapDates(), approvedSitemapDates);
  assert.equal(rejected.decision, "reject");
  assert.deepEqual(
    await publicRead(db, editionId),
    approved,
    "Rejected notice is not published; prior approved notice retained explicitly",
  );
  assert.equal((await read(db, editionId))!.reviewState, "rejected");
  assert.equal((await read(db, editionId))!.eligibleForReview, false);
  if (originalAllowlist === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAllowlist;
  // Fixture actor retained: immutable audit deliberately prevents deleting it.
  await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
});

test("actual lifecycle handlers→currentAdmin→DB decision/audit/read/replay and revoked-role conflict", async () => {
  const { loadReviewRoute, loadCurrentAdmin } =
    await import("./support/lifecycle-review-routes.mjs");
  const { requestHasTrustedOrigin } = await import("../lib/request-origin.ts");
  const priorAllow = process.env.ADMIN_EMAILS;
  const priorApp = process.env.APP_URL;
  process.env.ADMIN_EMAILS = email;
  process.env.APP_URL = "https://lifecycle.example.invalid";
  await db.user.update({ where: { id: actorId }, data: { role: "EDITOR" } });
  let present = true;
  const currentAdmin = await loadCurrentAdmin(async () =>
    present ? db.user.findUnique({ where: { id: actorId } }) : null,
  );
  const deps = {
    "@/lib/admin-access": { currentAdmin },
    "@/lib/db": { db },
    "@/lib/request-origin": { requestHasTrustedOrigin },
    "@/lib/ingestion/edition-lifecycle-proposal-store": {
      readPendingEditionLifecycle: read,
      decideEditionLifecycle: decide,
    },
  };
  const get = (await loadReviewRoute("editions", deps)).GET;
  const post = (await loadReviewRoute("snapshots", deps)).POST;
  const getRequest = new Request("https://lifecycle.example.invalid/review");
  const editionContext = { params: Promise.resolve({ id: editionId }) };
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (body: unknown, origin = "https://lifecycle.example.invalid") =>
    new Request("https://lifecycle.example.invalid/review", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const before = await db.festivalEdition.findMany();
    const n = await db.adminAuditEntry.count();
    const row = await stage(db, input(103));
    const payload = { decision: "approve", expectedContentHash: row.contentHash };
    const pending = await get(getRequest, editionContext);
    assert.equal(pending.status, 200);
    assert.equal(pending.headers.get("cache-control"), "private, no-store");
    assert.equal((await pending.json()).reviewState, "pending");
    present = false;
    assert.equal((await get(getRequest, editionContext)).status, 403);
    assert.equal((await post(request(payload), context(row.id))).status, 403);
    present = true;
    assert.equal(
      (await post(request(payload, "https://foreign.invalid"), context(row.id))).status,
      403,
    );
    assert.equal(
      (await post(request({ ...payload, actorId: "forged" }), context(row.id))).status,
      400,
    );
    assert.equal(
      (await post(request({ ...payload, expectedContentHash: "0".repeat(64) }), context(row.id)))
        .status,
      409,
    );
    assert.equal(await db.adminAuditEntry.count(), n);
    const approved = await post(request(payload), context(row.id));
    assert.equal(approved.status, 200);
    assert.deepEqual(await approved.json(), { snapshotId: row.id, decision: "approve" });
    assert.equal((await (await get(getRequest, editionContext)).json()).reviewState, "approved");
    assert.equal((await post(request(payload), context(row.id))).status, 200);
    assert.equal(await db.adminAuditEntry.count(), n + 1);
    const stored = await db.editionLifecycleReviewDecision.findUniqueOrThrow({
      where: { snapshotId: row.id },
      include: { audit: true },
    });
    assert.equal(stored.audit.actorId, actorId);
    // Session passed its check, but authority is revoked before the locked store recheck.
    const racedPost = (
      await loadReviewRoute("snapshots", {
        ...deps,
        "@/lib/admin-access": {
          currentAdmin: async () => {
            const actor = await currentAdmin();
            await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
            return actor;
          },
        },
      })
    ).POST;
    assert.equal((await racedPost(request(payload), context(row.id))).status, 409);
    assert.equal((await get(getRequest, editionContext)).status, 403);
    assert.equal(await db.adminAuditEntry.count(), n + 1);
    assert.deepEqual(await db.festivalEdition.findMany(), before);
  } finally {
    await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
    if (priorAllow === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = priorAllow;
    if (priorApp === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = priorApp;
  }
});

test("approved public proof remains fail-closed beneath a newer pending revision", async () => {
  await stage(db, input(104));
  const row = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
    where: { editionId, decision: { decision: "approve" } },
    orderBy: { observedAt: "desc" },
  });
  const approved = await publicRead(db, editionId);
  const decision = await db.editionLifecycleReviewDecision.findUniqueOrThrow({
    where: { snapshotId: row.id },
  });
  for (const patch of [{ decision: "reject" }, { contentHash: "0".repeat(64) }]) {
    await db.editionLifecycleReviewDecision.update({ where: { id: decision.id }, data: patch });
    try {
      await assert.rejects(publicRead(db, editionId));
    } finally {
      await db.editionLifecycleReviewDecision.update({
        where: { id: decision.id },
        data: { decision: decision.decision, contentHash: decision.contentHash },
      });
    }
  }
  await db.editionLifecycleProposalSnapshot.update({
    where: { id: row.id },
    data: { contentHash: "0".repeat(64) },
  });
  try {
    await assert.rejects(publicRead(db, editionId));
  } finally {
    await db.editionLifecycleProposalSnapshot.update({
      where: { id: row.id },
      data: { contentHash: row.contentHash },
    });
  }
  assert.deepEqual(await publicRead(db, editionId), approved);
  const latest = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
    where: { editionId },
    orderBy: { observedAt: "desc" },
  });
  await db.editionLifecycleProposalSnapshot.update({
    where: { id: latest.id },
    data: { httpStatus: 403 },
  });
  try {
    await assert.rejects(publicRead(db, editionId));
  } finally {
    await db.editionLifecycleProposalSnapshot.update({
      where: { id: latest.id },
      data: { httpStatus: 200 },
    });
  }
  assert.deepEqual(await publicRead(db, editionId), approved);
});

test(
  "real offline reader excludes approved pause, preserves other " +
    "events, stable ETag and fails closed on corruption",
  async () => {
    const other = await db.festival.create({
      data: {
        slug: "offline-synthetic-other",
        name: "Other offline fixture",
        country: "France",
        countryCode: "FR",
        officialUrl: "https://example.invalid/",
        genres: [],
        editions: {
          create: {
            year: 2027,
            recordState: "CURRENT",
            status: "CONFIRMED",
            ticketStatus: "UNKNOWN",
            completeness: "COMPLETE",
            sourceUpdatedAt: new Date(time),
            startDate: new Date("2027-07-01"),
          },
        },
      },
    });
    const req = (tag?: string) =>
      new Request("http://localhost/api/offline/catalog", {
        headers: tag ? { "if-none-match": tag } : {},
      });
    const readOffline = () => readOfflineCatalog(db);
    const before = await db.festivalEdition.findMany();
    try {
      await db.$transaction(async (tx) => {
        assert.equal(await readPublishedOfflineTrip(slug, 2027, tx), null);
        assert.equal(
          (await readPublishedOfflineTrip(other.slug, 2027, tx))?.startDate,
          "2027-07-01",
        );
      });
      const body = await readOffline();
      assert.equal(
        body.festivals.some((f) => f.slug === slug),
        false,
      );
      assert.equal(body.festivals.find((f) => f.slug === other.slug)!.startDate, "2027-07-01");
      const first = await serveOfflineCatalog(req(), readOffline);
      const tag = first.headers.get("etag")!;
      assert.equal((await serveOfflineCatalog(req(tag), readOffline)).status, 304);
      assert.doesNotMatch(
        await first.text(),
        /rock-en-seine|contentHash|actor|audit|sourceUrl|editionId/,
      );
      const approved = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
        where: { editionId, decision: { decision: "approve" } },
        orderBy: { observedAt: "desc" },
      });
      const latest = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
        where: { editionId },
        orderBy: { observedAt: "desc" },
      });
      for (const row of [approved, latest]) {
        await db.editionLifecycleProposalSnapshot.update({
          where: { id: row.id },
          data: { httpStatus: 403 },
        });
        try {
          const failure = await serveOfflineCatalog(req(tag), readOffline);
          assert.equal(failure.status, 503);
          assert.equal(failure.headers.get("etag"), null);
          assert.equal(failure.headers.get("cache-control"), "no-store");
        } finally {
          await db.editionLifecycleProposalSnapshot.update({
            where: { id: row.id },
            data: { httpStatus: row.httpStatus },
          });
        }
      }
      assert.equal((await serveOfflineCatalog(req(tag), readOffline)).status, 304);
      assert.deepEqual(await db.festivalEdition.findMany(), before);
    } finally {
      await db.festival.delete({ where: { id: other.id } });
    }
    // All paused is healthy empty, unlike absent DB rows (unavailable).
    const rollback = new Error("rollback isolated all-paused schedule");
    await assert.rejects(
      db.$transaction(
        async (tx) => {
          await tx.festivalEdition.updateMany({
            where: { id: { not: editionId }, year: 2027, recordState: "CURRENT" },
            data: { recordState: "TRACKING" },
          });
          assert.deepEqual((await readOfflineCatalog(tx)).festivals, []);
          assert.equal(
            (await serveOfflineCatalog(req(), () => readOfflineCatalog(tx))).status,
            200,
          );
          throw rollback;
        },
        { isolationLevel: "RepeatableRead" },
      ),
      (e) => e === rollback,
    );
  },
);

test(
  "actual main catalogue projects approved notice/current artists " +
    "but never rewrites raw or archive facts",
  async () => {
    const archive = await db.festivalEdition.create({
      data: {
        festivalId,
        year: 2026,
        recordState: "ARCHIVED",
        status: "CONFIRMED",
        ticketStatus: "UNKNOWN",
        completeness: "COMPLETE",
        sourceUpdatedAt: new Date(time),
        startDate: new Date("2026-08-25"),
      },
    });
    const evidence = await db.editionProvenance.createManyAndReturn({
      data: [editionId, archive.id].flatMap((id) =>
        ["dates", "headliners"].map((field) => ({
          editionId: id,
          field,
          url,
          checkedAt: new Date(time),
          note: "Synthetic proof",
        })),
      ),
    });
    const before = await db.festivalEdition.findMany();
    try {
      await db.lineupEntry.create({
        data: { editionId: archive.id, artistId, billing: "HEADLINER", position: 0 },
      });
      for (const [language, copy] of [
        ["en", "Edition on hiatus"],
        ["de", "Festivalausgabe pausiert"],
        ["ru", "Фестиваль на паузе"],
      ] as const) {
        const current = await readSocialPreview("festivals", slug, language, 2027);
        assert.equal(current?.detail, `2027 · ${copy}`);
        assert.equal(current?.headliners, undefined);
        const previous = await readSocialPreview("festivals", slug, language, 2026);
        assert.equal(
          previous?.detail,
          formatFestivalDateRange({ startDate: "2026-08-25" }, language, ""),
        );
        assert.deepEqual(previous?.headliners, ["Lifecycle Synthetic Artist"]);
      }
      const result = await new DatabaseCatalogRepository(db).read();
      const f = result.festivals.find((f) => f.slug === slug)!;
      assert.deepEqual(f.editionLifecycle, await publicRead(db, editionId));
      assert.equal(f.startDate, "2027-08-25");
      assert.equal(f.ticketStatus, "unknown");
      assert.deepEqual(f.headliners, ["Lifecycle Synthetic Artist"]);
      assert.deepEqual(result.discoveryLineups.artistSlugsByFestival[slug], []);
      assert.equal(
        result.artists.some((a) => a.name === "Lifecycle Synthetic Artist"),
        false,
      );
      assert.equal(
        result.editions.find((e) => e.slug === slug && e.editionYear === 2026)!.editionLifecycle,
        undefined,
      );
      assert.doesNotMatch(JSON.stringify(f), /contentHash|actorId|auditId|eligibleForReview/);
      const latest = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({
        where: { editionId },
        orderBy: { observedAt: "desc" },
      });
      await db.editionLifecycleProposalSnapshot.update({
        where: { id: latest.id },
        data: { httpStatus: 403 },
      });
      try {
        await assert.rejects(new DatabaseCatalogRepository(db).read());
      } finally {
        await db.editionLifecycleProposalSnapshot.update({
          where: { id: latest.id },
          data: { httpStatus: latest.httpStatus },
        });
      }
      assert.deepEqual(await db.festivalEdition.findMany(), before);
    } finally {
      await db.editionProvenance.deleteMany({
        where: { id: { in: evidence.map(({ id }) => id) } },
      });
      await db.festivalEdition.delete({ where: { id: archive.id } });
    }
  },
);
