import { readCatalog } from "../lib/catalog/repository.ts";
import { createPrismaClient } from '../lib/prisma-client.mjs';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
import { seedCatalog } from "./support/seed-catalog.ts";
import { publishAdminFestivalChange, publishIngestionResult } from "../lib/catalog/publication.ts";
import { catalogSeed } from "./support/catalog.ts";
import { createIngestionRun, persistAttempt } from "../lib/ingestion/repository.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { parserSource } from "./support/parser-source.ts";
import type { IngestionResult } from "../lib/ingestion/types.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) throw new Error("A test DATABASE_URL is required");
const db = createPrismaClient();
const execute = promisify(execFile);
const suffix = `${Date.now()}-${process.pid}`;
const createdArtists: string[] = [];
let initialRockharzJobs = 0;

function result(artist: string, overrides: Partial<IngestionResult> = {}): IngestionResult {
  const fetchedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    festivalSlug: "synthetic-fest",
    sourceUrl: "https://festival.example.test/",
    fetchedAt,
    changes: [{ kind: "artist_added", field: "lineup", after: artist, reviewRequired: false }],
    candidate: {
      schemaVersion: 1,
      festivalSlug: "synthetic-fest",
      sourceUrl: "https://festival.example.test/",
      fetchedAt,
      startDate: "2027-06-10",
      lineup: [artist],
      evidence: [{ field: "lineup", sourceUrl: "https://festival.example.test/", observedAt: fetchedAt, excerpt: artist }],
      warnings: [],
      observedEditionYears: [2027],
    },
    publishable: true,
    reviewReasons: [],
    ...overrides,
  };
}

async function persist(value: IngestionResult) {
  const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: suffix, totalSources: 1 });
  return persistAttempt(db, {
    runId: run.id,
    festivalSlug: value.festivalSlug,
    requestedUrl: value.sourceUrl,
    finalUrl: value.sourceUrl,
    httpStatus: 200,
    durationMs: 1,
    startedAt: new Date(value.fetchedAt),
    endedAt: new Date(value.fetchedAt),
    result: value,
  });
}

test.before(async () => {
  const rockharz = { ...catalogSeed.festivals[0], slug: "rockharz", name: "Synthetic Rockharz", city: "Ballenstedt", headliners: [], lineup: [], startDate: "2027-07-07", endDate: "2027-07-10" };
  const rfp = JSON.parse(await readFile(new URL('./fixtures/official-markup/rfp-reviewed-20261103.json', import.meta.url), 'utf8'));
  const rfpFestival = {...rockharz, ...rfp, name:'Synthetic Rock for People'};
  const download={...rockharz,slug:"download",name:"Synthetic Download",headliners:[],lineup:[],status:"tba" as const,startDate:"2027-06-09",endDate:"2027-06-13"};
  const graspop={...rockharz,slug:'graspop',name:'Synthetic Graspop',status:'tba' as const,startDate:'2027-06-17',endDate:'2027-06-20'};
  const rfpArtists = [...rfp.headliners, ...rfp.lineup].map((name: string) => ({
    ...catalogSeed.artists[0], name, slug: name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }));
  await seedCatalog(db, { ...catalogSeed, artists:[...catalogSeed.artists,...rfpArtists], festivals: [...catalogSeed.festivals, rfpFestival, rockharz, {...rockharz,slug:"idays",name:"Synthetic I-Days"},graspop,download], editions: [...catalogSeed.editions,
    { ...catalogSeed.editions.find((e) => e.recordState === "current")!, ...rfpFestival, recordState: "current" as const },
    { ...catalogSeed.editions.find((e) => e.recordState === "current")!, ...rockharz, recordState: "current" as const },
    { ...catalogSeed.editions.find((e) => e.recordState === "current")!, ...rockharz, slug:"idays", recordState: "current" as const },
    { ...catalogSeed.editions.find((e) => e.recordState === "current")!, ...download, completeness:"tba" as const, recordState:"current" as const },
    { ...catalogSeed.editions.find((e) => e.recordState === "current")!, ...graspop, completeness:'tba' as const, recordState: "current" as const }],
  });
  // The shared fixture seeder deliberately defaults records to confirmed.
  await db.festivalEdition.updateMany({where:{festival:{slug:{in:['graspop','download']}},recordState:'CURRENT'},data:{status:'TBA',completeness:'TBA'}});
  initialRockharzJobs = await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } });
});
test.after(async () => {
  await db.catalogPlaylistRefresh.deleteMany({ where: { publication: { sourceId: { startsWith: `ingestion:` } }, festivalSlug: "synthetic-fest" } });
  if (createdArtists.length) {
    await db.lineupEntry.deleteMany({ where: { artist: { slug: { in: createdArtists } } } });
    await db.artist.deleteMany({ where: { slug: { in: createdArtists } } });
  }
  await seedCatalog(db, catalogSeed);
  await db.$disconnect();
});

test("commits catalog rows, candidate state, audit snapshot and playlist request together", async () => {
  const artist = `Catalog Transaction ${suffix}`;
  const value = result(artist);
  const attempt = await persist(value);
  const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.ok(publication);
  assert.equal(publication.playlistRefreshRequested, true);
  createdArtists.push(encodeURIComponent(artist.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")));

  const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  assert.equal(stored.reviewState, "PUBLISHED");
  assert.equal(stored.catalogueVersion, publication.id);
  const lineup = await db.lineupEntry.findFirst({ where: { edition: { festival: { slug: "synthetic-fest" }, recordState: "CURRENT" }, artist: { name: artist } } });
  assert.ok(lineup);
  const queued = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { publicationId: publication.id } });
  assert.equal(queued.status, "PENDING");

  const repeated = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.equal(repeated?.id, publication.id);
  assert.equal(await db.catalogPublication.count({ where: { sourceId: publication.sourceId } }), 1);
  await assert.rejects(db.catalogPublication.update({ where: { id: publication.id }, data: { actorLabel: "tampered" } }), /append-only/);
  await assert.rejects(db.catalogPublication.delete({ where: { id: publication.id } }), /append-only/);
});

test("fails closed and rolls back every catalog row when artist identity is ambiguous", async () => {
  const requestedName = `Ambiguous Artist ${suffix}`;
  const slug = encodeURIComponent(requestedName.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  await db.artist.create({ data: { slug, name: `${requestedName} Other`, aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } });
  createdArtists.push(slug);
  const value = result(requestedName);
  const attempt = await persist(value);
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /Artist slug collision/);
  assert.equal(await db.catalogPublication.count({ where: { sourceId: { startsWith: "ingestion:" }, evidence: { path: ["candidateId"], equals: (await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).id } } }), 0);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).reviewState, "PENDING");
  assert.equal(await db.lineupEntry.count({ where: { edition: { festival: { slug: "synthetic-fest" } }, artist: { name: requestedName } } }), 0);
});

test("reuses the canonical artist when the observed name differs only by case", async () => {
  const canonicalName = `Case Artist ${suffix}`;
  const observedName = `Case artist ${suffix}`;
  const slug = encodeURIComponent(canonicalName.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  const canonical = await db.artist.create({ data: { slug, name: canonicalName, aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } });
  createdArtists.push(slug);
  const value = result(observedName);
  const attempt = await persist(value);

  const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });

  assert.ok(publication);
  assert.equal(await db.artist.count({ where: { slug } }), 1);
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug: "synthetic-fest" }, recordState: "CURRENT" },
    select: { id: true },
  });
  const lineup = await db.lineupEntry.findUniqueOrThrow({ where: { editionId_artistId: { editionId: edition.id, artistId: canonical.id } } });
  assert.equal(lineup.artistId, canonical.id);
});

test("rejects an edition mismatch before changing the catalog", async () => {
  const artist = `Wrong Edition ${suffix}`;
  const value = result(artist);
  value.candidate.observedEditionYears = [2028];
  const attempt = await persist(value);
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /does not match catalogue edition/);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).reviewState, "PENDING");
  assert.equal(await db.artist.count({ where: { name: artist } }), 0);
});

test("leased publication rejects an expired or reclaimed worker before catalog writes", async () => {
  const artist = `Lease Publication ${suffix}`;
  const value = result(artist);
  const attempt = await persist(value);
  const candidate = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: value.festivalSlug } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id, recordState: "CURRENT" } });
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const source = await db.festivalSource.create({ data: {
    festivalSlug: value.festivalSlug, festivalId: festival.id, editionId: edition.id, url: value.sourceUrl,
    strategies: ["manual_review"], parserKey: "manual_review", refreshPolicy: "daily", cadenceSeconds: 86400,
    editionYear: edition.year, configurationBackfilledAt: new Date(), leaseOwner: ownerA,
    leaseExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
  } });
  const slug = encodeURIComponent(artist.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  createdArtists.push(slug);
  try {
    await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix,
      notificationEvents: [], sourceLease: { id: source.id, owner: ownerA, updatedAt: source.updatedAt } }), /lease is no longer active/);
    assert.equal(await db.catalogPublication.count({ where: { sourceId: "ingestion:" + candidate.id } }), 0);
    assert.equal(await db.artist.count({ where: { slug } }), 0);
    const reassigned = await db.festivalSource.update({ where: { id: source.id }, data: { leaseOwner: ownerB, leaseExpiresAt: new Date(Date.now() + 300_000), updatedAt: new Date("2030-01-01T00:00:00.000Z") } });
    await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix,
      notificationEvents: [], sourceLease: { id: source.id, owner: ownerA, updatedAt: source.updatedAt } }), /lease is no longer active/);
    await db.festivalSource.update({ where: { id: source.id }, data: { enabled: false, updatedAt: new Date("2031-01-01T00:00:00.000Z") } });
    await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix,
      notificationEvents: [], sourceLease: { id: source.id, owner: ownerB, updatedAt: reassigned.updatedAt } }), /lease is no longer active/);
    const restored = await db.festivalSource.update({ where: { id: source.id }, data: { enabled: true, updatedAt: new Date("2032-01-01T00:00:00.000Z") } });
    await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix,
      notificationEvents: [], sourceLease: { id: source.id, owner: ownerB, updatedAt: reassigned.updatedAt } }), /lease is no longer active/);
    const published = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix,
      notificationEvents: [], sourceLease: { id: source.id, owner: ownerB, updatedAt: restored.updatedAt } });
    assert.ok(published);
    assert.equal(await db.catalogPublication.count({ where: { sourceId: "ingestion:" + candidate.id } }), 1);
  } finally {
    await db.festivalSource.delete({ where: { id: source.id } });
  }
});

test("production Node exports playlist input from the committed database catalog", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-playlist-export-"));
  const output = path.join(directory, "catalog.json");
  try {
    const execution = await execute(process.execPath, ["scripts/export-playlist-catalog.mjs", output], { env: process.env });
    const exported = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exported.season, 2027);
    assert.match(execution.stdout, new RegExp("Exported " + exported.festivals.length + " festivals for 2027"));
    assert.ok(exported.festivals.some(({ slug, artists }: { slug: string; artists: string[] }) =>
      slug === "synthetic-fest" && artists.includes("Sample Artist")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// These cases only run under requireLocalDisposableDatabase above. No source
// configuration rows are created or converted by the fixture.
test("guarded Rockharz sources UPDATE existing 2027 rows, queue verified lineup changes and replay idempotently", async () => {
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: "rockharz" } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id, year: 2027, recordState: "CURRENT" } });
  await db.festivalEdition.update({ where: { id: edition.id }, data: { status: "TBA" } });
  const sources = [
    ["bands", "https://www.rockharz-festival.com/bands"],
    ["headliner", "https://www.rockharz-festival.com/headliner-alarm"],
    ["soldout", "https://www.rockharz-festival.com/das-rockharz-2027-ist-ausverkauft"],
  ];
  for (const [key, url] of sources) {
    const html = await readFile(new URL(`./fixtures/official-markup/rockharz-${key}-2027.html`, import.meta.url), "utf8");
    const candidate = extractFestivalCandidate(html, parserSource("rockharz", { url }), new Date().toISOString());
    const value = evaluateCandidate({ ...catalogSeed.festivals[0], slug: "rockharz", editionYear: 2027, city: "Ballenstedt", startDate: "2027-07-07", endDate: "2027-07-10", status: "tba", lineup: [], headliners: [], ticketStatus: "unknown" }, candidate);
    assert.equal(value.publishable, true);
    const artistsBefore = new Set((await db.artist.findMany({ select: { slug: true } })).map((a) => a.slug));
    const attempt = await persist(value);
    const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
    assert.ok(publication);
    if (key === "headliner") {
      assert.deepEqual(publication.fields.sort(), ["headliners", "status"]);
      assert.equal((await db.festivalEdition.findUniqueOrThrow({ where: { id: edition.id } })).status, "PARTIAL");
    }
    for (const a of await db.artist.findMany({ select: { slug: true } })) if (!artistsBefore.has(a.slug)) createdArtists.push(a.slug);
    assert.equal(publication.playlistRefreshRequested, key !== "soldout");
    assert.equal(await db.catalogPlaylistRefresh.count({ where: { publicationId: publication.id } }), key !== "soldout" ? 1 : 0);
    const evidence = publication.evidence as { sourceUrl: string; evidenceIds: string[]; playlistRefresh?: { status: string; policy: string; reason: string } };
    assert.equal(evidence.sourceUrl, url);
    assert.ok(evidence.evidenceIds.length);
    assert.equal(publication.lineupChanged, key !== "soldout");
    assert.equal(evidence.playlistRefresh, undefined);
    const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
    assert.equal(stored.reviewState, "PUBLISHED");
    assert.equal(stored.catalogueVersion, publication.id);
    const replay = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
    assert.equal(replay?.id, publication.id);
    assert.equal(replay?.playlistRefreshRequested, key !== "soldout");
    assert.equal(await db.catalogPlaylistRefresh.count({ where: { publicationId: publication.id } }), key !== "soldout" ? 1 : 0);
    assert.equal(await db.catalogPublication.count({ where: { sourceId: publication.sourceId } }), 1);
  }
  assert.equal((await db.festival.findUniqueOrThrow({ where: { slug: "rockharz" } })).id, festival.id);
  assert.equal(await db.festivalEdition.count({ where: { festivalId: festival.id, year: 2027 } }), 1);
  assert.equal((await db.festivalEdition.findUniqueOrThrow({ where: { id: edition.id } })).ticketStatus, "SOLD_OUT");
  const lineup = await db.lineupEntry.findMany({ where: { editionId: edition.id }, include: { artist: true } });
  assert.equal(lineup.filter((e) => e.billing === "LINEUP").length, 29);
  assert.deepEqual(lineup.filter((e) => e.billing === "HEADLINER").map((e) => e.artist.name), ["AMON AMARTH"]);
  assert.equal(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } }), initialRockharzJobs + 2);
});

test("Rockharz status-only repair after 30 acts preserves artists/tickets and never queues on replay", async () => {
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug: "rockharz" }, year: 2027, recordState: "CURRENT" } });
  await db.festivalEdition.update({ where: { id: edition.id }, data: { status: "TBA" } });
  const entries = await db.lineupEntry.findMany({ where: { editionId: edition.id }, include: { artist: true }, orderBy: { id: "asc" } });
  assert.equal(entries.length, 30);
  assert.equal(edition.ticketStatus, "SOLD_OUT");
  const url = "https://www.rockharz-festival.com/headliner-alarm";
  const html = await readFile(new URL("./fixtures/official-markup/rockharz-headliner-2027.html", import.meta.url), "utf8");
  const candidate = extractFestivalCandidate(html, parserSource("rockharz", { url }), new Date().toISOString());
  const current = { ...catalogSeed.festivals[0], slug: "rockharz", editionYear: 2027, status: "tba" as const,
    ticketStatus: "sold_out" as const, headliners: ["AMON AMARTH"], lineup: entries.filter((e) => e.billing === "LINEUP").map((e) => e.artist.name) };
  const value = evaluateCandidate(current, candidate);
  assert.equal(value.publishable, true);
  assert.deepEqual(value.changes.map((c) => c.field), ["status"]);
  const attempt = await persist(value);
  const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.ok(publication);
  assert.deepEqual(publication.fields, ["status"]);
  assert.equal(publication.lineupChanged, false);
  assert.equal(publication.playlistRefreshRequested, false);
  const updated = await db.festivalEdition.findUniqueOrThrow({ where: { id: edition.id } });
  assert.equal(updated.status, "PARTIAL");
  assert.equal(updated.ticketStatus, "SOLD_OUT");
  assert.deepEqual(await db.lineupEntry.findMany({ where: { editionId: edition.id }, include: { artist: true }, orderBy: { id: "asc" } }), entries);
  const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  assert.equal(stored.reviewState, "PUBLISHED");
  assert.equal(stored.catalogueVersion, publication.id);
  const replay = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.equal(replay?.id, publication.id);
  assert.equal(replay?.playlistRefreshRequested, false);
  assert.equal(await db.catalogPublication.count({ where: { sourceId: publication.sourceId } }), 1);
  assert.equal(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } }), initialRockharzJobs + 2);
  assert.deepEqual(evaluateCandidate({ ...current, status: "partial" }, candidate).changes, []);
});

test("Rockharz status-only repair rejects source, edition and status evidence drift atomically", async () => {
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug: "rockharz" }, year: 2027, recordState: "CURRENT" } });
  const url = "https://www.rockharz-festival.com/headliner-alarm";
  const html = await readFile(new URL("./fixtures/official-markup/rockharz-headliner-2027.html", import.meta.url), "utf8");
  for (const drift of ["url", "edition", "candidate-evidence", "persisted-evidence"]) {
    await db.festivalEdition.update({ where: { id: edition.id }, data: { status: "TBA" } });
    const candidate = extractFestivalCandidate(html, parserSource("rockharz", { url }), new Date().toISOString());
    const value = evaluateCandidate({ ...catalogSeed.festivals[0], slug: "rockharz", editionYear: 2027, status: "tba", headliners: ["AMON AMARTH"] }, candidate);
    if (drift === "url") {
      value.sourceUrl += "/";
      candidate.sourceUrl = value.sourceUrl;
      candidate.evidence.forEach((e) => e.sourceUrl = value.sourceUrl);
    }
    if (drift === "edition") candidate.observedEditionYears = [];
    if (drift === "candidate-evidence") candidate.evidence = candidate.evidence.filter((e) => e.field !== "status");
    const persistedValue = structuredClone(value);
    if (drift === "persisted-evidence") persistedValue.candidate.evidence = persistedValue.candidate.evidence.filter((e) => e.field !== "status");
    const attempt = await persist(persistedValue);
    await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /matching verified source evidence/);
    assert.equal((await db.festivalEdition.findUniqueOrThrow({ where: { id: edition.id } })).status, "TBA");
    const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
    assert.equal(stored.reviewState, "PENDING");
    assert.equal(await db.catalogPublication.count({ where: { sourceId: "ingestion:" + stored.id } }), 0);
    assert.equal(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } }), initialRockharzJobs + 2);
  }
});

test("unreviewed Rockharz 2027 lineup source fails closed without provider queue or partial catalogue write", async () => {
  const name = `Unsupported Source ` + suffix;
  const value = result(name, { festivalSlug: "rockharz", sourceUrl: "https://www.rockharz-festival.com/bands/" });
  value.candidate.festivalSlug = value.festivalSlug;
  value.candidate.sourceUrl = value.sourceUrl;
  value.candidate.evidence.forEach((e) => e.sourceUrl = value.sourceUrl);
  value.candidate.status = "partial";
  value.candidate.evidence.push({ field: "status", sourceUrl: value.sourceUrl, observedAt: value.fetchedAt, excerpt: "Synthetic wrong-source status" });
  value.changes.push({ kind: "status_changed", field: "status", before: "tba", after: "partial", reviewRequired: false });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug: "rockharz" }, year: 2027, recordState: "CURRENT" } });
  await db.festivalEdition.update({ where: { id: edition.id }, data: { status: "TBA" } });
  const attempt = await persist(value);
  const before = await db.artist.count();
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /matching verified source evidence/);
  assert.equal(await db.artist.count(), before);
  assert.equal((await db.festivalEdition.findUniqueOrThrow({ where: { id: edition.id } })).status, "TBA");
  const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  assert.equal(await db.catalogPublication.count({ where: { sourceId: "ingestion:" + stored.id } }), 0);
  assert.equal(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } }), initialRockharzJobs + 2);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).reviewState, "PENDING");
});

test("Rockharz scoped publication collision rolls back partial rows and retains PENDING candidate", async () => {
  const first = `Scoped First ${suffix}`, collision = `Scoped Collision ${suffix}`;
  const slugFor = (name: string) => encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  await db.artist.create({ data: { slug: slugFor(collision), name: `${collision} Other`, aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } });
  createdArtists.push(slugFor(collision));
  const value = result(first, { festivalSlug: "rockharz", sourceUrl: "https://www.rockharz-festival.com/bands" });
  value.candidate.festivalSlug = value.festivalSlug;
  value.candidate.sourceUrl = value.sourceUrl;
  value.candidate.lineup = [first, collision];
  value.candidate.evidence.forEach((e) => e.sourceUrl = value.sourceUrl);
  value.changes.push({ kind: "artist_added", field: "lineup", after: collision, reviewRequired: false });
  const attempt = await persist(value);
  const before = await db.lineupEntry.count({ where: { edition: { festival: { slug: "rockharz" }, year: 2027 } } });
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /Artist slug collision/);
  assert.equal(await db.artist.count({ where: { slug: slugFor(first) } }), 0);
  assert.equal(await db.lineupEntry.count({ where: { edition: { festival: { slug: "rockharz" }, year: 2027 } } }), before);
  const candidate = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  assert.equal(candidate.reviewState, "PENDING");
  assert.equal(await db.catalogPublication.count({ where: { sourceId: "ingestion:" + candidate.id } }), 0);
  assert.equal(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: "rockharz" } }), initialRockharzJobs + 2);
});

function idaysResult(name: string): IngestionResult {
  const value = result(name, { festivalSlug: "idays", sourceUrl: "https://www.idays.it/" });
  value.changes = [{kind: "headliner_added", field: "headliners", after: name, reviewRequired: false}];
  value.candidate = {...value.candidate, festivalSlug: value.festivalSlug, sourceUrl: value.sourceUrl,
    artistListMode: "additive", headliners: [name], lineup: undefined,
    evidence: [{field:"headliners", sourceUrl:value.sourceUrl, observedAt:value.fetchedAt, excerpt:name}]};
  return value;
}

test("verified I-Days additions publish atomically without provider jobs, including replay", async () => {
  const value = idaysResult(`Synthetic Idays Headliner ${suffix}`);
  const attempt = await persist(value);
  const before = await db.catalogPlaylistRefresh.count();
  const publication = await publishIngestionResult(db, {attemptId:attempt.id, result:value, sourceCommit:suffix});
  assert.ok(publication);assert.equal(publication.playlistRefreshRequested,false);
  const stored = await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}});
  assert.equal(stored.reviewState,"PUBLISHED");assert.equal(stored.catalogueVersion,publication.id);
  assert.ok(await db.lineupEntry.findFirst({where:{edition:{festival:{slug:"idays"}},artist:{name:value.changes[0].after!},billing:"HEADLINER"}}));
  assert.equal((publication.evidence as {playlistRefresh:{policy:string}}).playlistRefresh.policy,"explicit-refresh-only");
  assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.playlistRefreshRequested,false);
  assert.equal(await db.catalogPlaylistRefresh.count(),before);
});

test("I-Days provenance drift and identity collisions roll back without catalog or provider writes",async()=>{
  for(const drift of ["host","edition","mode","evidence","persisted-evidence","requested-url","billing","identity"]) {
    const name=`Synthetic Idays Drift ${drift} ${suffix}`;
    const value=idaysResult(name);
    if(drift==="host") {value.sourceUrl="https://evil.test/";value.candidate.sourceUrl=value.sourceUrl;value.candidate.evidence.forEach(e=>e.sourceUrl=value.sourceUrl);}
    if(drift==="edition") value.candidate.observedEditionYears=[];
    if(drift==="mode") value.candidate.artistListMode=undefined;
    if(drift==="evidence") value.candidate.evidence=[];
    if(drift==="billing") {
      const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:"idays"},recordState:"CURRENT"}});
      const artist=await db.artist.create({data:{slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),name,identityState:"UNRESOLVED",aliases:[],genres:[],topTracks:[],recentSetlists:[],freshness:{}}});
      await db.lineupEntry.create({data:{editionId:edition.id,artistId:artist.id,billing:"LINEUP",position:0}});
    }
    if(drift==="identity") await db.artist.create({data:{slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),name:name+" Other",identityState:"UNRESOLVED",aliases:[],genres:[],topTracks:[],recentSetlists:[],freshness:{}}});
    const persisted=structuredClone(value);
    if(drift==="persisted-evidence") persisted.candidate.evidence=[];
    if(drift==="requested-url") persisted.sourceUrl="https://www.idays.it/line-up";
    const attempt=await persist(persisted);
    const before={artists:await db.artist.count(),entries:await db.lineupEntry.count(),jobs:await db.catalogPlaylistRefresh.count(),publications:await db.catalogPublication.count()};
    await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/I-Days publication requires|Ambiguous billing|Artist slug collision/);
    assert.deepEqual({artists:await db.artist.count(),entries:await db.lineupEntry.count(),jobs:await db.catalogPlaylistRefresh.count(),publications:await db.catalogPublication.count()},before);
    assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,"PENDING");
  }
});

function graspopResult(name:string):IngestionResult {
 const value=result(name,{festivalSlug:'graspop',sourceUrl:'https://www.graspop.be/en/info/festival-essentials'});
 value.changes=[{kind:'headliner_added',field:'headliners',after:name,reviewRequired:false},{kind:'status_changed',field:'status',before:'tba',after:'partial',reviewRequired:false}];
 value.candidate={...value.candidate,festivalSlug:'graspop',sourceUrl:value.sourceUrl,startDate:'2027-06-17',endDate:'2027-06-20',status:'partial',headliners:[name],lineup:undefined,artistListMode:'additive',lineupScope:'announcement',evidence:['startDate','endDate','headliners','status'].map(field=>({field:field as 'startDate'|'endDate'|'headliners'|'status',sourceUrl:value.sourceUrl,observedAt:value.fetchedAt,excerpt:'Synthetic independently corroborated announcement'}))};
 return value;
}
test('verified Graspop additions publish catalogue/status/completeness atomically, never provider jobs, including replay',async()=>{
 const value=graspopResult(`Synthetic Graspop Head ${suffix}`);const attempt=await persist(value);const jobs=await db.catalogPlaylistRefresh.count();
 const publication=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});
 assert.ok(publication);assert.equal(publication.playlistRefreshRequested,false);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'graspop'},recordState:'CURRENT'},include:{lineup:true}});
 assert.equal(edition.status,'PARTIAL');assert.equal(edition.completeness,'PARTIAL');assert.equal(edition.lineup.length,1);
 assert.equal((publication.evidence as any).playlistRefresh.policy,'explicit-refresh-only');
 const replay=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.equal(replay?.id,publication.id);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
});
test('Graspop provenance, edition, mode, persisted-value, requested-source and removal drift roll back without provider effects',async()=>{
 for(const drift of ['host','edition','mode','evidence','persisted-value','persisted-mode','requested-source','removal']) {
  const value=graspopResult(`Synthetic Graspop ${drift} ${suffix}`);
  if(drift==='host'){value.sourceUrl='https://evil.test/';value.candidate.sourceUrl=value.sourceUrl;value.candidate.evidence.forEach(e=>e.sourceUrl=value.sourceUrl);}
  if(drift==='edition')value.candidate.observedEditionYears=[2026];
  if(drift==='mode')value.candidate.artistListMode=undefined;
  if(drift==='evidence')value.candidate.evidence=[];
  if(drift==='removal')value.changes[0].kind='headliner_removed';
  const stored=structuredClone(value);
  if(drift==='persisted-value')stored.candidate.headliners=['Different synthetic name'];
  if(drift==='persisted-mode')stored.candidate.lineupScope=undefined;
  if(drift==='requested-source')stored.sourceUrl='https://www.graspop.be/en/';
  const attempt=await persist(stored);
  const counts=async()=>({artists:await db.artist.count(),entries:await db.lineupEntry.count(),jobs:await db.catalogPlaylistRefresh.count(),publications:await db.catalogPublication.count()});const before=await counts();
  await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/Graspop publication requires|Candidate edition 2026 does not match catalogue edition 2027/);
  assert.deepEqual(await counts(),before);assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,'PENDING');
 }
});


test('RFP official additions publish once, retain Neck Deep and queue normal playlist work', async()=>{
  const current=JSON.parse(await readFile(new URL('./fixtures/official-markup/rfp-reviewed-20261103.json',import.meta.url),'utf8'));
  const html=await readFile(new URL('./fixtures/official-markup/rfp-current-20261103.html',import.meta.url),'utf8');
  const candidate=extractFestivalCandidate(html,parserSource('rock-for-people',{url:'https://rockforpeople.cz/'}),new Date().toISOString());
  const value=evaluateCandidate(current,candidate);
  assert.equal(value.publishable,true);assert.equal(value.changes.length,46);
  const attempt=await persist(value);
  const publication=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});
  assert.ok(publication?.playlistRefreshRequested);
  const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:current.slug},recordState:'CURRENT'},include:{lineup:{include:{artist:true}}}});
  assert.equal(edition.lineup.length,63);assert.ok(edition.lineup.some(x=>x.artist.name==='Neck Deep'));
  assert.equal(await db.catalogPlaylistRefresh.count({where:{publicationId:publication.id}}),1);
  const again=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});
  assert.equal(again?.id,publication.id);
  assert.equal(await db.catalogPlaylistRefresh.count({where:{publicationId:publication.id}}),1);
  const full={...current,headliners:edition.lineup.filter(x=>x.billing==='HEADLINER').map(x=>x.artist.name),lineup:edition.lineup.filter(x=>x.billing!=='HEADLINER').map(x=>x.artist.name)};
  assert.deepEqual(evaluateCandidate(full,candidate).changes,[]);
});


test('real Graspop full bill crosses persisted publication fences once, preserving provider deferral and old artists',async()=>{
 const bundle=JSON.parse(await readFile(new URL('./fixtures/graspop-current/full-announcement.json',import.meta.url),'utf8'));
 const candidate=extractFestivalCandidate(JSON.stringify(bundle),parserSource('graspop',{url:'https://www.graspop.be/en/info/festival-essentials'}),new Date().toISOString());
 const value=evaluateCandidate({slug:'graspop',editionYear:2027,name:'Synthetic Graspop',startDate:'2027-06-17',endDate:'2027-06-20',status:'partial',ticketStatus:'unknown',headliners:[],lineup:[]} as any,candidate);
 assert.equal(value.publishable,true);assert.equal(candidate.lineup?.length,102);
 const old=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'graspop'},recordState:'CURRENT'},include:{lineup:true}});
 const jobs=await db.catalogPlaylistRefresh.count();const artists=new Set((await db.artist.findMany({select:{slug:true}})).map(a=>a.slug));
 const attempt=await persist(value);const publication=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.ok(publication);
 for(const a of await db.artist.findMany({select:{slug:true}}))if(!artists.has(a.slug))createdArtists.push(a.slug);
 const saved=await db.festivalEdition.findUniqueOrThrow({where:{id:old.id},include:{lineup:{include:{artist:true}}}});
 assert.equal(saved.lineup.length,old.lineup.length+110);assert.ok(old.lineup.every(a=>saved.lineup.some(b=>b.id===a.id&&b.billing===a.billing)));
 assert.equal(saved.lineup.filter(a=>candidate.lineup?.some(n=>n.toLowerCase()===a.artist.name.toLowerCase()) && a.billing==='LINEUP').length,102);
 assert.equal(publication.playlistRefreshRequested,false);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.id,publication.id);
 const broken=structuredClone(value);broken.candidate.evidence=broken.candidate.evidence.filter(e=>e.field!=='lineup');const invalid=await persist(broken);
 const counts=()=>Promise.all([db.artist.count(),db.lineupEntry.count(),db.catalogPublication.count(),db.catalogPlaylistRefresh.count()]);
 const before=await counts();await assert.rejects(publishIngestionResult(db,{attemptId:invalid.id,result:broken,sourceCommit:suffix}),/Graspop publication requires/);assert.deepEqual(await counts(),before);
});

 test('Download full official bill publishes 100 acts and partial completeness without provider jobs, replay is idempotent',async()=>{
 const bundle=JSON.parse(await readFile(new URL('./fixtures/download-announcement.json',import.meta.url),'utf8'));
 const candidate=extractFestivalCandidate(JSON.stringify(bundle),parserSource('download',{url:'https://downloadfestival.co.uk/'}),new Date().toISOString());
 const value=evaluateCandidate({slug:'download',editionYear:2027,startDate:'2027-06-09',endDate:'2027-06-13',headliners:[],lineup:[],status:'tba',ticketStatus:'unknown'} as any,candidate);
 assert.equal(value.publishable,true);const attempt=await persist(value);const jobs=await db.catalogPlaylistRefresh.count();
 const pub=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.ok(pub);assert.equal(pub.playlistRefreshRequested,false);
 const ed=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'download'},recordState:'CURRENT'},include:{lineup:true}});
 assert.equal(ed.lineup.length,100);assert.equal(ed.lineup.filter(l=>l.billing==='HEADLINER').length,3);assert.equal(ed.status,'PARTIAL');assert.equal(ed.completeness,'PARTIAL');
 assert.equal(await db.catalogPlaylistRefresh.count(),jobs);assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.id,pub.id);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 });

test('Download status-only announcement repairs TBA completeness with an already stored roster',async()=>{
 const bundle=JSON.parse(await readFile(new URL('./fixtures/download-announcement.json',import.meta.url),'utf8'));
 const candidate=extractFestivalCandidate(JSON.stringify(bundle),parserSource('download',{url:'https://downloadfestival.co.uk/'}),new Date().toISOString());
 const ed=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'download'},recordState:'CURRENT'}});
 await db.festivalEdition.update({where:{id:ed.id},data:{status:'TBA',completeness:'TBA'}});
 const value=evaluateCandidate({slug:'download',editionYear:2027,startDate:'2027-06-09',endDate:'2027-06-13',headliners:candidate.headliners!,lineup:candidate.lineup!,status:'tba',ticketStatus:'unknown'} as any,candidate);
 assert.equal(value.publishable,true);assert.deepEqual(value.changes.map(c=>c.field),['status']);
 const attempt=await persist(value);const jobs=await db.catalogPlaylistRefresh.count();
 const pub=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.ok(pub);
 const after=await db.festivalEdition.findUniqueOrThrow({where:{id:ed.id},include:{lineup:true}});
 assert.equal(after.status,'PARTIAL');assert.equal(after.completeness,'PARTIAL');assert.equal(after.lineup.length,100);
 assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.id,pub.id);
});

test('Download completeness-only repair flows through DB catalog, policy, persisted diffs and publication',async()=>{
 const bundle=JSON.parse(await readFile(new URL('./fixtures/download-announcement.json',import.meta.url),'utf8'));
 const candidate=extractFestivalCandidate(JSON.stringify(bundle),parserSource('download',{url:'https://downloadfestival.co.uk/'}),new Date().toISOString());
 const ed=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'download'},recordState:'CURRENT'}});
 await db.festivalEdition.update({where:{id:ed.id},data:{status:'PARTIAL',completeness:'TBA'}});
 const current=(await readCatalog({database:db})).festivals.find(f=>f.slug==='download')!;
 assert.equal(current.completeness,'tba');
 const value=evaluateCandidate(current,candidate);assert.equal(value.publishable,true);assert.deepEqual(value.changes.map(c=>c.field),['completeness']);
 const jobs=await db.catalogPlaylistRefresh.count();const attempt=await persist(value);
 const pub=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.ok(pub);
 assert.deepEqual(pub.fields,['completeness']);assert.equal(pub.playlistRefreshRequested,false);
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.id,pub.id);
 const after=(await readCatalog({database:db})).festivals.find(f=>f.slug==='download')!;
 assert.equal(after.completeness,'partial');assert.equal(after.status,'partial');assert.equal(after.headliners.length+after.lineup.length,100);
 assert.deepEqual(evaluateCandidate(after,candidate).changes,[]);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
});
test('unverified Download addition cannot acquire provider deferral or publish catalogue rows',async()=>{
 const bundle=JSON.parse(await readFile(new URL('./fixtures/download-announcement.json',import.meta.url),'utf8'));
 const candidate=extractFestivalCandidate(JSON.stringify(bundle),parserSource('download',{url:'https://downloadfestival.co.uk/'}),new Date().toISOString());
 candidate.sourceUrl='https://untrusted.example/';candidate.lineup!.push(`Unverified Download ${suffix}`);
 const current=(await readCatalog({database:db})).festivals.find(f=>f.slug==='download')!;
 const value=evaluateCandidate(current,candidate);assert.equal(value.publishable,false);
 // Exercise publication's independent guard even if an upstream caller bypasses policy.
 value.publishable=true;value.reviewReasons=[];
 const attempt=await persist(value);
 const counts=()=>Promise.all([db.artist.count(),db.lineupEntry.count(),db.catalogPublication.count(),db.catalogPlaylistRefresh.count()]);
 const before=await counts();
 await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/Download publication requires verified official announcement evidence/);
 assert.deepEqual(await counts(),before);
});


test("Rock am Ring formatting variants reuse canonical IDs without renaming artists", async () => {
  for (const [canonicalName, observedName] of [[`HANABIE ${suffix}.`, `Hanabie ${suffix}`], [`Maple's Pet Dinosaur ${suffix}`, `Maple’s Pet Dinosaur ${suffix}`]]) {
    const slug = canonicalName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const canonical = await db.artist.create({data:{slug,name:canonicalName,aliases:[],genres:[],identityState:"UNRESOLVED",topTracks:[],recentSetlists:[],freshness:{}}});
    createdArtists.push(slug);
    const value=result(observedName), attempt=await persist(value);
    assert.ok(await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}));
    assert.equal((await db.artist.findUniqueOrThrow({where:{id:canonical.id}})).name,canonicalName);
    assert.equal(await db.artist.count({where:{slug}}),1);
    assert.equal(await db.lineupEntry.count({where:{artistId:canonical.id,edition:{festival:{slug:"synthetic-fest"}}}}),1);
  }
});

test("formatting-equivalent duplicate identities stay blocked and roll back", async () => {
  const stem=`Formatting Duplicate ${suffix}`;
  const slug=stem.toLowerCase().replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"");
  for(const [name,identitySlug] of [[stem,slug],[stem+".",slug+"-other"]]) {
    await db.artist.create({data:{slug:identitySlug,name,aliases:[],genres:[],identityState:"UNRESOLVED",topTracks:[],recentSetlists:[],freshness:{}}});
    createdArtists.push(identitySlug);
  }
  const value=result(stem),attempt=await persist(value);
  await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/Ambiguous artist identity/);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,"PENDING");
});

test("mixed-apostrophe duplicate identity is rejected before any catalog write", async () => {
  const stem=`Rock 'n' Roll ${suffix}`;
  const slug=stem.toLowerCase().replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"");
  for(const [name,identitySlug] of [[stem,slug],[`Rock ‘n’ Roll ${suffix}`,slug+"-other"]]) {
    await db.artist.create({data:{slug:identitySlug,name,aliases:[],genres:[],identityState:"UNRESOLVED",topTracks:[],recentSetlists:[],freshness:{}}});
    createdArtists.push(identitySlug);
  }
  const value=result(stem),attempt=await persist(value);
  const counts=()=>Promise.all([db.lineupEntry.count(),db.catalogPublication.count(),db.catalogPlaylistRefresh.count()]);
  const before=await counts();
  await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/Ambiguous artist identity/);
  assert.deepEqual(await counts(),before);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,"PENDING");
});

test('Provinssi shell imports official dates and 19 unranked acts without provider jobs; replay is idempotent',async()=>{
 await db.festival.deleteMany({where:{slug:'provinssi'}}); // Local disposable DB only; make repeated suite runs independent.
 const f=await db.festival.create({data:{slug:'provinssi',name:'Synthetic Provinssi',country:'Finland',countryCode:'FI',officialUrl:'https://www.provinssi.fi/en/',genres:[]}});
 const shell=await db.festivalEdition.create({data:{festivalId:f.id,year:2027,status:'TBA',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'TBA',sourceUpdatedAt:new Date()}});
 const html=await readFile(new URL('./fixtures/official-markup/provinssi-excerpt.html',import.meta.url),'utf8');
 const c=extractFestivalCandidate(html,parserSource('provinssi',{url:'https://www.provinssi.fi/en/'}),new Date().toISOString());
 const current=(await readCatalog({database:db})).festivals.find(f=>f.slug==='provinssi')!;
 const value=evaluateCandidate(current,c);assert.equal(value.publishable,true);assert.deepEqual(value.reviewReasons,[]);
 const attempt=await persist(value),jobs=await db.catalogPlaylistRefresh.count();
 const pub=await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix});assert.ok(pub);assert.equal(pub.playlistRefreshRequested,false);
 const ed=await db.festivalEdition.findUniqueOrThrow({where:{id:shell.id},include:{lineup:true}});
 assert.equal(ed.startDate?.toISOString().slice(0,10),'2027-07-01');assert.equal(ed.endDate?.toISOString().slice(0,10),'2027-07-03');assert.equal(ed.lineup.length,19);assert.ok(ed.lineup.every(l=>l.billing==='LINEUP'));assert.equal(ed.status,'PARTIAL');assert.equal(ed.completeness,'PARTIAL');assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 assert.equal((await publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}))?.id,pub.id);assert.equal(await db.catalogPlaylistRefresh.count(),jobs);
 const after=(await readCatalog({database:db})).festivals.find(f=>f.slug==='provinssi')!;assert.deepEqual(evaluateCandidate(after,c).changes,[]);
});

test('Provinssi provenance drift rolls back catalogue, completeness and provider writes',async()=>{
 const html=await readFile(new URL('./fixtures/official-markup/provinssi-excerpt.html',import.meta.url),'utf8');
 for (const drift of ['url','edition','mode','evidence','persisted-mode','persisted-value','requested-url','removal']) {
  const c=extractFestivalCandidate(html,parserSource('provinssi',{url:'https://www.provinssi.fi/en/'}),new Date().toISOString());
  c.lineup!.push(`Synthetic Provinssi ${drift} ${suffix}`);
  const current=(await readCatalog({database:db})).festivals.find(f=>f.slug==='provinssi')!;
  const value=evaluateCandidate(current,c);
  if(drift==='url') {value.sourceUrl=c.sourceUrl='https://untrusted.example/';c.evidence.forEach(e=>e.sourceUrl=c.sourceUrl);}
  if(drift==='edition') c.observedEditionYears=[2026];
  if(drift==='mode') delete c.artistListMode;
  if(drift==='evidence') c.evidence=[];
  if(drift==='removal') value.changes[0].kind='artist_removed';
  const attempt=await persist(value);
  if(drift==='persisted-mode'||drift==='persisted-value') {
   const normalized=JSON.parse(JSON.stringify(c));
   if(drift==='persisted-mode') delete normalized.artistListMode; else normalized.lineup=['Unverified artist'];
   await db.ingestionCandidate.update({where:{attemptId:attempt.id},data:{normalized}});
  }
  if(drift==='requested-url') await db.ingestionAttempt.update({where:{id:attempt.id},data:{requestedUrl:'https://untrusted.example/'}});
  const counts=()=>Promise.all([db.lineupEntry.count(),db.catalogPublication.count(),db.catalogPlaylistRefresh.count(),db.festivalEdition.findMany({where:{festival:{slug:'provinssi'}}})]);
  const before=await counts();
  await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result:value,sourceCommit:suffix}),/Provinssi publication requires|Candidate edition 2026/);
  assert.deepEqual(await counts(),before);
 }
});


test("explicit ticket states survive reviewed publication and canonical public readback", async () => {
  const { ticketPresentation } = await import("../lib/tickets.ts");
  const { festivalMusicEvent } = await import("../lib/seo.ts");
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug: "synthetic-fest" }, recordState: "CURRENT" } });
  let previous = edition.ticketStatus.toLowerCase();
  try {
    for (const status of ["not_on_sale", "available", "low", "sold_out", "sales_ended", "unavailable", "unknown"] as const) {
      const publication = await db.$transaction(tx => publishAdminFestivalChange(tx, {
        actorLabel: "synthetic-ticket-review",
        change: { id: `ticket-${suffix}-${status}`, resourceKey: "synthetic-fest", field: "ticketStatus", beforeValue: previous, afterValue: status,
          sourceEvidence: { url: "https://festival.example.test/tickets", note: `Synthetic reviewed ${status} fixture` }, parserRunId: null },
      }));
      assert.ok(publication);
      assert.equal(publication.playlistRefreshRequested, false);
      const { festivals } = await readCatalog({ database: db });
      const item = festivals.find(item => item.slug === "synthetic-fest")!;
      assert.equal(item.ticketStatus, status);
      const linked = { ...item, ticketsUrl: "https://festival.example.test/tickets" };
      assert.equal(ticketPresentation(linked).status, status);
      assert.equal(festivalMusicEvent(linked).offers?.availability === "https://schema.org/SoldOut", status === "sold_out");
      const stored = await db.catalogPublication.findUniqueOrThrow({ where: { id: publication.id } });
      assert.deepEqual(stored.fields, ["ticketStatus"]);
      assert.equal((stored.evidence as any).sourceEvidence.url, linked.ticketsUrl);
      previous = status;
    }
  } finally {
    await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: edition.ticketStatus, sourceUpdatedAt: edition.sourceUpdatedAt } });
  }
});

for (const slug of ["wacken-open-air", "download", "rock-am-ring", "rock-im-park"]) {
  test(`${slug}: fetch → producer → durable ticket evidence → canonical readback and replay`, async () => {
    const { fetchSource } = await import("../lib/ingestion/fetch.ts");
    const { TICKET_SUPPLEMENT, ticketSupplementUrl } = await import("../lib/ingestion/ticket-supplements.ts");
    const source = parserSource(slug, { url: slug === "download" ? "https://downloadfestival.co.uk/" : slug === "wacken-open-air" ? "https://www.wacken.com/" : `https://www.${slug}.com/`,
      strategies: ["html_fallback"] });
    const ticketUrl = ticketSupplementUrl(source)!;
    const fixture = await readFile(new URL(`./fixtures/ticket-status/${slug === "download" ? "download-regular-admission" : slug === "wacken-open-air" ? "wacken-standard-pass" : `${slug}-regular-admission`}.html`, import.meta.url), "utf8");
    const festival = await db.festival.upsert({ where: { slug }, create: { slug, name: `Synthetic ${slug}`, country: "Testland", countryCode: "DE", officialUrl: source.url, genres: [] }, update: {} });
    const edition = await db.festivalEdition.upsert({ where: { festivalId_year: { festivalId: festival.id, year: 2027 } },
      create: { festivalId: festival.id, year: 2027, status: "PARTIAL", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "PARTIAL", sourceUpdatedAt: new Date("2026-01-01") },
      update: { ticketStatus: "UNKNOWN", ticketsUrl: null } });
    const current = () => readCatalog({ database: db }).then(c => c.festivals.find(f => f.slug === slug)!);
    const jobs = await db.catalogPlaylistRefresh.count();
    const providerJobs = await db.festivalPlaylist.count();
    // Frozen, minimal official structural fixtures only: no live provider calls.
    const requested: string[] = [];
    const fetched = await fetchSource(source, { maxAttempts: 1, fetchImpl: async target => {
      requested.push(String(target));
      return new Response(String(target) === ticketUrl ? fixture : `<a href="${ticketUrl}">Tickets</a>`, { headers: { "content-type": "text/html" } });
    } });
    assert.ok(requested.includes(ticketUrl));
    const candidate = extractFestivalCandidate(await fetched.response.text(), source, new Date().toISOString());
    const value = evaluateCandidate(await current(), candidate);
    assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
    assert.equal(candidate.ticketStatus, "available"); // sold-out side products must not win
    const attempt = await persist(value);
    const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
    assert.ok(publication);
    assert.equal(publication.playlistRefreshRequested, false);
    const item = await current();
    assert.equal(item.ticketStatus, "available");
    assert.equal(item.ticketsUrl, ticketUrl);
    const evidence = await db.ingestionEvidence.findMany({ where: { candidate: { attemptId: attempt.id }, field: { in: ["ticketStatus", "ticketsUrl"] } } });
    assert.equal(evidence.length, 2);
    assert.ok(evidence.every(e => e.sourceUrl === ticketUrl && (publication.evidence as any).evidenceIds.includes(e.id)));
    assert.equal((await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }))?.id, publication.id);
    assert.deepEqual(evaluateCandidate(item, candidate).changes, []);
    assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
    assert.equal(await db.festivalPlaylist.count(), providerJobs);

    for (const [name, html, url] of [
      ["archived", fixture.replaceAll("2027", "2026"), ticketUrl],
      ["missing", "<html><title>Temporarily unavailable</title></html>", ticketUrl],
      ["foreign", fixture, "https://foreign.example.test/tickets"],
    ]) {
      const invalid = extractFestivalCandidate(JSON.stringify({ kind: TICKET_SUPPLEMENT, body: `<a href="${ticketUrl}">Tickets</a>`, ticket: { url, html } }), source, new Date().toISOString());
      const blocked = evaluateCandidate(await current(), invalid);
      assert.equal(blocked.publishable, false, name);
      const persisted = await persist(blocked);
      await assert.rejects(publishIngestionResult(db, { attemptId: persisted.id, result: blocked, sourceCommit: suffix }));
      assert.equal((await current()).ticketStatus, "available");
    }
    // A result that passed policy still cannot bypass corrupted durable evidence.
    for (const mutation of ["missing", "foreign", "value", "edition", "request", "provenance"]) {
      await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: "UNKNOWN", ticketsUrl: null } });
      const clean = evaluateCandidate(await current(), candidate);
      const saved = await persist(clean);
      const where = { candidate: { attemptId: saved.id }, field: "ticketStatus" };
      if (mutation === "missing") await db.ingestionEvidence.deleteMany({ where });
      if (mutation === "foreign") await db.ingestionEvidence.updateMany({ where, data: { sourceUrl: "https://foreign.example.test/tickets" } });
      if (mutation === "value") await db.ingestionEvidence.updateMany({ where, data: { observedValue: "sold_out" } });
      if (mutation === "edition") await db.ingestionCandidate.update({ where: { attemptId: saved.id }, data: { normalized: { ...candidate, observedEditionYears: [2026] } as any } });
      if (mutation === "request") await db.ingestionAttempt.update({ where: { id: saved.id }, data: { requestedUrl: "https://foreign.example.test/" } });
      if (mutation === "provenance") delete clean.candidate.ticketSupplement;
      const before = await db.catalogPublication.count();
      await assert.rejects(publishIngestionResult(db, { attemptId: saved.id, result: clean, sourceCommit: suffix }), /persisted official ticket evidence/, mutation);
      assert.equal(await db.catalogPublication.count(), before, mutation);
      assert.equal((await current()).ticketStatus, "unknown", mutation);
      assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
      assert.equal(await db.festivalPlaylist.count(), providerJobs);
    }
  });
}

test("explicitly configured non-supplemental Wacken JSON-LD stock retains the existing publication path", async () => {
  const source = parserSource("wacken-open-air", { url: "https://www.wacken.com/custom-official-inventory", fetchUrl: "https://www.wacken.com/custom-official-inventory", strategies: ["json_ld_event"] });
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicEvent", name: "Wacken Open Air", startDate: "2027-07-28", endDate: "2027-07-31", offers: { url: source.url, availability: "https://schema.org/InStock" } })}</script>`;
  const candidate = extractFestivalCandidate(html, source, new Date().toISOString());
  assert.equal(candidate.ticketSupplement, undefined);
  assert.equal(candidate.ticketStatus, "available");
  const current = (await readCatalog({ database: db })).festivals.find(f => f.slug === source.festivalSlug)!;
  const value = evaluateCandidate(current, candidate);
  assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
  const attempt = await persist(value);
  assert.ok(await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }));
  assert.equal((await readCatalog({ database: db })).festivals.find(f => f.slug === source.festivalSlug)!.ticketStatus, "available");
});
