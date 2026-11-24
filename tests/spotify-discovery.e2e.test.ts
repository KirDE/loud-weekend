import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import {
  clearSpotifyDiscovery,
  discoverSpotifyChunk,
  pruneSpotifyDiscovery,
} from "../lib/catalog/spotify-discovery.ts";
import { claimPlaylistRefresh } from "../lib/catalog/playlist-queue.ts";
import { providerRetryDelay } from "../lib/catalog/playlist-provider-worker.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
test.after(async () => db.$disconnect());
test("discovery scratch resumes exact inputs, rejects lost lease, never stages a partial plan", async () => {
  const slug = "discovery-" + randomUUID();
  const f = await db.festival.create({
    data: {
      slug,
      name: "Synthetic",
      country: "Test",
      countryCode: "DE",
      genres: [],
      officialUrl: "https://example.test/",
      editions: {
        create: {
          year: 2027,
          status: "PARTIAL",
          ticketStatus: "UNKNOWN",
          recordState: "CURRENT",
          completeness: "PARTIAL",
          sourceUpdatedAt: new Date(),
        },
      },
    },
  });
  const p = await db.catalogPublication.create({
    data: {
      source: "ADMIN",
      sourceId: slug,
      festivalSlug: slug,
      editionYear: 2027,
      actorLabel: "test",
      fields: ["lineup"],
      lineupChanged: true,
    },
  });
  const j = await db.catalogPlaylistRefresh.create({
    data: { publicationId: p.id, festivalSlug: slug, requestedAt: new Date("1900-01-01") },
  });
  const key = `playlist-discovery:spotify:v1:${j.id}`;
  try {
    const { claim } = await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120000 });
    assert.ok(claim);
    assert.equal(claim.id, j.id);
    const checkpoint = { followers: { Alpha: 1 }, report: [], uris: [], songKeys: [] };
    await assert.rejects(
      discoverSpotifyChunk(db, claim, { season: 2027 }, async () => ({
        discoveryCheckpoint: checkpoint,
      })),
      { code: "SPOTIFY_DISCOVERY_CHECKPOINT" },
    );
    assert.equal(
      (await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: j.id } })).desiredPlan,
      null,
    );
    const reordered = { season: 2027, profiles: { Beta: { b: 2, a: 1 }, Alpha: { a: 3 } } };
    await assert.rejects(
      discoverSpotifyChunk(db, claim, reordered, async () => ({ discoveryCheckpoint: checkpoint })),
      { code: "SPOTIFY_DISCOVERY_CHECKPOINT" },
    );
    await discoverSpotifyChunk(
      db,
      claim,
      { profiles: { Alpha: { a: 3 }, Beta: { a: 1, b: 2 } }, season: 2027 },
      async (input) => {
        assert.deepEqual((input as any).discoveryCheckpoint, checkpoint);
        return { track_uris: [] };
      },
    );
    await assert.rejects(
      discoverSpotifyChunk(db, claim, { season: 2027 }, async () => ({
        discoveryCheckpoint: { report: "界".repeat(1500000) },
      })),
      /Invalid discovery checkpoint/,
    );
    await assert.rejects(
      discoverSpotifyChunk(db, claim, { text: "a".repeat(6 * 1024 * 1024) }, async () => ({
        discoveryCheckpoint: { report: "a".repeat(3 * 1024 * 1024) },
      })),
      /Invalid discovery checkpoint/,
    );
    await assert.rejects(
      discoverSpotifyChunk(db, claim, { season: 2027 }, async () => ({
        discoveryCheckpoint: checkpoint,
      })),
      { code: "SPOTIFY_DISCOVERY_CHECKPOINT" },
    );
    const complete = { track_uris: ["synthetic"], report: [] };
    assert.deepEqual(
      await discoverSpotifyChunk(db, claim, { season: 2027 }, async (input) => {
        assert.deepEqual((input as any).discoveryCheckpoint, checkpoint);
        return complete;
      }),
      complete,
    );
    await discoverSpotifyChunk(db, claim, { season: 2028 }, async (input) => {
      assert.equal((input as any).discoveryCheckpoint, undefined);
      return complete;
    });
    await assert.rejects(clearSpotifyDiscovery(db, claim), /Durable Spotify plan required/);
    await db.catalogPlaylistRefresh.update({
      where: { id: j.id },
      data: { desiredPlan: complete },
    });
    await clearSpotifyDiscovery(db, claim);
    assert.equal(await db.operationalState.findUnique({ where: { key } }), null);
    await db.catalogPlaylistRefresh.update({
      where: { id: j.id },
      data: { leaseExpiresAt: new Date("1900-01-01") },
    });
    await assert.rejects(
      discoverSpotifyChunk(db, claim, { season: 2027 }, async () => {
        throw Error("must not run");
      }),
    );
    assert.equal(await db.operationalState.findUnique({ where: { key } }), null);
    // Superseded/abandoned jobs are never reclaimed: native idle retention still
    // collects stale scratch, but not fresh scratch, unrelated state or active jobs.
    const stale = new Date(Date.now() - 8 * 86400000);
    await db.operationalState.create({ data: { key, payload: checkpoint, updatedAt: stale } });
    const freshKey = key + "-fresh",
      unrelated = "unrelated-" + randomUUID();
    await db.operationalState.createMany({
      data: [
        { key: freshKey, payload: checkpoint },
        { key: unrelated, payload: checkpoint, updatedAt: stale },
      ],
    });
    await pruneSpotifyDiscovery(db);
    assert.ok(await db.operationalState.findUnique({ where: { key } })); // RUNNING, even expired: recovery owns it
    await db.catalogPlaylistRefresh.update({
      where: { id: j.id },
      data: { status: "PENDING", leaseOwner: null, leaseExpiresAt: null },
    });
    await pruneSpotifyDiscovery(db);
    assert.equal(await db.operationalState.findUnique({ where: { key } }), null);
    assert.ok(await db.operationalState.findUnique({ where: { key: freshKey } }));
    assert.ok(await db.operationalState.findUnique({ where: { key: unrelated } }));
    await db.operationalState.deleteMany({ where: { key: { in: [freshKey, unrelated] } } });
    assert.equal(providerRetryDelay(100, { code: "SPOTIFY_DISCOVERY_CHECKPOINT" }), 60000);
    assert.equal(providerRetryDelay(100, { playlistRpcTimedOut: true }), 86400000);
  } finally {
    await db.operationalState.deleteMany({ where: { key } });
    await db.catalogPlaylistRefresh.updateMany({
      where: { id: j.id },
      data: { status: "SUCCEEDED", leaseOwner: null, leaseExpiresAt: null },
    });
    await db.festival.delete({ where: { id: f.id } });
  }
});
