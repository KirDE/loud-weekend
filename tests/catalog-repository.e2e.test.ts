import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
import { seedCatalog } from "./support/seed-catalog.ts";
import { DatabaseCatalogRepository, readCatalog } from "../lib/catalog/repository.ts";
import { catalogSeed } from "./support/catalog.ts";

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

test("provider playlist coverage reads the current edition and independent measured timestamps", async () => {
  const current = await db.festivalEdition.findFirstOrThrow({ where: { recordState: "CURRENT" } });
  const archived = await db.festivalEdition.findFirstOrThrow({
    where: { recordState: "ARCHIVED" },
  });
  const spotifyUrl = "https://open.spotify.com/playlist/1234567890123456789012";
  const youtubeUrl = "https://music.youtube.com/playlist?list=Synthetic01";
  const firstSync = new Date("2026-11-18T14:00:00.000Z");
  const secondSync = new Date("2026-11-20T12:00:00.000Z");
  const get = async () => (await readCatalog({ database: db })).playlists["synthetic-fest"];
  await db.festivalPlaylist.createMany({
    data: [
      {
        editionId: archived.id,
        provider: "spotify",
        url: spotifyUrl,
        artistCount: 999,
        trackCount: 1999,
        syncedAt: secondSync,
      },
      {
        editionId: current.id,
        provider: "youtube_music",
        url: youtubeUrl,
        artistCount: 8,
        trackCount: 14,
        syncedAt: firstSync,
      },
    ],
  });
  let playlist = await get();
  assert.equal(playlist.spotifyUrl, undefined);
  assert.equal(playlist.youtubeMusicUrl, youtubeUrl);
  assert.deepEqual(playlist.coverage?.youtubeMusic, {
    matchedArtists: 8,
    tracks: 14,
    recordedAt: firstSync.toISOString(),
  });

  const currentSpotifyUrl = "https://open.spotify.com/playlist/2234567890123456789012";
  const currentSpotify = await db.festivalPlaylist.create({
    data: {
      editionId: current.id,
      provider: "spotify",
      url: currentSpotifyUrl,
      artistCount: 110,
      trackCount: 220,
      syncedAt: secondSync,
    },
  });
  playlist = await get();
  assert.equal(playlist.spotifyUrl, currentSpotifyUrl);
  assert.deepEqual(playlist.coverage?.spotify, {
    matchedArtists: 110,
    tracks: 220,
    recordedAt: secondSync.toISOString(),
  });
  await db.festivalPlaylist.update({ where: { id: currentSpotify.id }, data: { syncedAt: null } });
  playlist = await get();
  assert.equal(playlist.spotifyUrl, currentSpotifyUrl);
  assert.equal(playlist.coverage?.spotify, undefined);
  assert.equal(playlist.coverage?.youtubeMusic?.recordedAt, firstSync.toISOString());
});
