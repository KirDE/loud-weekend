import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "./disposable-db.ts";
import { seedCatalog } from "./seed-catalog.ts";
import { catalogSeed } from "./catalog.ts";
import { readCatalog } from "../../lib/catalog/repository.ts";
import { publishIngestionResult } from "../../lib/catalog/publication.ts";
import { createIngestionRun, persistAttempt } from "../../lib/ingestion/repository.ts";
import { evaluateCandidate } from "../../lib/ingestion/policy.ts";
import type { FestivalCandidate, IngestionResult } from "../../lib/ingestion/types.ts";

/** Frozen public structural source data, local synthetic DB and mocked GET only. */
export function ticketProducerPublication(input: { slug: string; produce: (archived?: boolean) => Promise<FestivalCandidate> }) {
  test(`${input.slug}: source producer → persisted evidence → canonical readback/replay and stale-publication rollback`, async () => {
    requireLocalDisposableDatabase(process.env.DATABASE_URL);
    const db = createPrismaClient(), sourceCommit = `test-ticket-${randomUUID()}`;
    const persist = async (value: IngestionResult) => {
      const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit, totalSources: 1 });
      return persistAttempt(db, { runId: run.id, festivalSlug: input.slug, requestedUrl: value.sourceUrl,
        finalUrl: value.sourceUrl, httpStatus: 200, durationMs: 1, startedAt: new Date(value.fetchedAt), endedAt: new Date(value.fetchedAt), result: value });
    };
    const read = async () => (await readCatalog({ database: db })).festivals.find(f => f.slug === input.slug)!;
    try {
      const candidate = await input.produce();
      assert.ok(candidate.ticketStatus, "fixture must exercise actual source-backed ticket status");
      assert.equal(candidate.festivalSlug, input.slug);
      assert.equal(candidate.observedEditionYears.length, 1);
      const year = candidate.observedEditionYears[0];
      const names = [...new Set([...(candidate.headliners ?? []), ...(candidate.lineup ?? [])])];
      const artists = [];
      for (const [i, name] of names.entries()) {
        const existing = await db.artist.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
        artists.push({ ...catalogSeed.artists[0], name, slug: existing?.slug ?? `ticket-${input.slug}-${i}-${sourceCommit}` });
      }
      const festival = { ...catalogSeed.festivals[0], slug: input.slug, name: `Synthetic ${input.slug}`, officialUrl: candidate.sourceUrl,
        editionYear: year, startDate: candidate.startDate ?? `${year}-06-01`, endDate: candidate.endDate ?? `${year}-06-04`,
        city: candidate.city, headliners: candidate.headliners ?? [], lineup: candidate.lineup ?? [] };
      await seedCatalog(db, { ...catalogSeed, artists: [...catalogSeed.artists, ...artists], festivals: [...catalogSeed.festivals, festival],
        editions: [...catalogSeed.editions, { ...festival, recordState: "current", completeness: "partial", provenance: [] }] });
      const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug: input.slug }, year, recordState: "CURRENT" } });
      await db.festivalEdition.update({ where: { id: edition.id }, data: { status: candidate.status === "confirmed" ? "CONFIRMED" : candidate.status === "tba" ? "TBA" : "PARTIAL", ticketStatus: "UNKNOWN", ticketsUrl: null } });
      const jobs = await db.catalogPlaylistRefresh.count(), bindings = await db.festivalPlaylist.count();
      const value = evaluateCandidate(await read(), candidate);
      assert.equal(value.publishable, true, JSON.stringify(value.reviewReasons));
      assert.ok(value.changes.some(c => c.field === "ticketStatus"));
      assert.ok(value.changes.every(c => ["ticketStatus", "ticketsUrl"].includes(c.field)), "stock check must not publish artists");
      const attempt = await persist(value);
      const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit });
      assert.ok(publication);
      assert.equal(publication.playlistRefreshRequested, false);
      const after = await read();
      assert.equal(after.ticketStatus, candidate.ticketStatus);
      assert.equal(after.ticketsUrl, candidate.ticketsUrl);
      const durable = await db.ingestionEvidence.findMany({ where: { candidate: { attemptId: attempt.id } } });
      for (const change of value.changes) {
        const proof = candidate.evidence.filter(e => e.field === change.field);
        assert.ok(proof.length, change.field);
        assert.ok(proof.some(e => durable.some(saved => saved.field === e.field && saved.sourceUrl === e.sourceUrl &&
          JSON.stringify(saved.observedValue) === JSON.stringify(candidate[e.field]) &&
          (publication.evidence as { evidenceIds: string[] }).evidenceIds.includes(saved.id))), change.field);
      }
      assert.equal((await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit }))?.id, publication.id);
      assert.deepEqual(evaluateCandidate(after, candidate).changes, []);
      assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
      assert.equal(await db.festivalPlaylist.count(), bindings);
      const archived = evaluateCandidate(after, await input.produce(true));
      assert.equal(archived.publishable, false, "old-edition source must not overwrite current inventory");
      const archivedAttempt = await persist(archived);
      await assert.rejects(publishIngestionResult(db, { attemptId: archivedAttempt.id, result: archived, sourceCommit }));
      assert.equal((await read()).ticketStatus, candidate.ticketStatus);
      // A candidate valid when persisted must not overwrite a newer catalogue
      // observation; any earlier fields applied in that transaction roll back.
      await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: "UNKNOWN", ticketsUrl: null } });
      const stale = evaluateCandidate(await read(), candidate), staleAttempt = await persist(stale);
      await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: candidate.ticketStatus === "low" ? "SOLD_OUT" : "LOW" } });
      const publications = await db.catalogPublication.count();
      await assert.rejects(publishIngestionResult(db, { attemptId: staleAttempt.id, result: stale, sourceCommit }), /Stale ticketStatus/);
      assert.equal(await db.catalogPublication.count(), publications);
      assert.equal((await read()).ticketStatus, candidate.ticketStatus === "low" ? "sold_out" : "low");
      assert.equal((await read()).ticketsUrl, undefined);
      assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
      assert.equal(await db.festivalPlaylist.count(), bindings);
    } finally {
      await seedCatalog(db, catalogSeed);
      await db.$disconnect();
    }
  });
}
