import { createPrismaClient } from "../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import {
  spotifyRepertoiresForArtists,
  repertoireBindingKey,
} from "../lib/catalog/spotify-repertoire.ts";
import { festivalSpotifyArtists } from "../lib/catalog/selection-artists.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
test.after(() => db.$disconnect());
for (const single of [false, true])
  test(
    "single=" +
      single +
      ": configuration preview/apply, DB worker transport and idempot" +
      "ency do not alter identities, plans or providers",
    async () => {
      const slug = "test-repertoire-" + randomUUID();
      await db.artist.create({
        data: {
          slug,
          name: slug,
          aliases: [],
          genres: [],
          topTracks: [],
          recentSetlists: [],
          freshness: {},
          identityState: "UNRESOLVED",
        },
      });
      const profile = {
        schemaVersion: 1,
        key: slug + ":v1",
        artistSlugs: [slug],
        setlistArtist: "Anchor",
        searchArtists: [
          { id: "a".repeat(22), name: "Anchor" },
          { id: "b".repeat(22), name: "Singer" },
          { id: "c".repeat(22), name: "Singer & Band" },
        ],
        anchorArtistIds: ["a".repeat(22)],
        collaborationArtistIds: ["b".repeat(22), "c".repeat(22)],
        albumIds: ["d".repeat(22)],
        sourceUrls: ["https://open.spotify.com/album/" + "d".repeat(22)],
      };
      if (single) {
        profile.searchArtists = profile.searchArtists.slice(0, 1);
        profile.collaborationArtistIds = [];
      }
      const invoke = (value, apply = false) =>
        spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/configure-spotify-repertoire.ts",
            ...(apply ? ["--apply"] : []),
          ],
          { input: JSON.stringify(value), encoding: "utf8", timeout: 20000, env: process.env },
        );
      const before = {
        identities: await db.artistIdentity.count(),
        lineup: await db.lineupEntry.count(),
        jobs: await db.catalogPlaylistRefresh.count(),
      };
      const keys = [
        "spotify-repertoire-profile:" + profile.key,
        "spotify-repertoire-binding:" + slug,
        "spotify-repertoire-audit:" + profile.key,
      ];
      const preview = invoke(profile);
      assert.equal(preview.status, 0, preview.stderr);
      assert.equal(JSON.parse(preview.stdout).apply, false);
      assert.equal(await db.operationalState.count({ where: { key: { in: keys } } }), 0);
      const applied = invoke(profile, true);
      assert.equal(applied.status, 0, applied.stderr);
      assert.equal(await db.operationalState.count({ where: { key: { in: keys } } }), 3);
      const transported = await spotifyRepertoiresForArtists(db, [{ slug, name: slug }]);
      assert.deepEqual(transported[slug], profile);
      const replay = invoke(profile, true);
      assert.equal(replay.status, 0, replay.stderr);
      assert.equal(JSON.parse(replay.stdout).existing, true);
      assert.equal(await db.operationalState.count({ where: { key: { in: keys } } }), 3);
      assert.notEqual(invoke({ ...profile, setlistArtist: "Different" }, true).status, 0);
      assert.notEqual(invoke({ ...profile, key: slug + ":v2" }, true).status, 0);
      assert.equal(
        await db.operationalState.count({
          where: { key: "spotify-repertoire-profile:" + slug + ":v2" },
        }),
        0,
      );
      assert.notEqual(
        invoke({ ...profile, artistSlugs: ["nonexistent-" + randomUUID()] }, true).status,
        0,
      );
      assert.deepEqual(
        {
          identities: await db.artistIdentity.count(),
          lineup: await db.lineupEntry.count(),
          jobs: await db.catalogPlaylistRefresh.count(),
        },
        before,
      );
      assert.deepEqual(
        (await spotifyRepertoiresForArtists(db, [{ slug, name: slug }]))[slug],
        profile,
      );
    },
  );

test("audited edition configuration rejects unannounced/archive scope and cannot leak to another edition", async () => {
  const slug = "scope-" + randomUUID();
  const artist = await db.artist.create({
    data: {
      slug,
      name: slug,
      aliases: [],
      genres: [],
      topTracks: [],
      recentSetlists: [],
      freshness: {},
      identityState: "UNRESOLVED",
    },
  });
  const festival = await db.festival.create({
    data: {
      slug,
      name: slug,
      country: "Synthetic",
      countryCode: "XX",
      officialUrl: "https://example.com",
      genres: [],
      editions: {
        create: [2027, 2028].map((year) => ({
          year,
          status: "CONFIRMED",
          ticketStatus: "UNKNOWN",
          recordState: year === 2027 ? "CURRENT" : "ARCHIVED",
          completeness: "PARTIAL",
          sourceUpdatedAt: new Date(),
        })),
      },
    },
    include: { editions: true },
  });
  const current = festival.editions.find((e) => e.year === 2027);
  const profile = {
    schemaVersion: 1,
    key: slug + ":v1",
    artistSlugs: [slug],
    setlistArtist: slug,
    searchArtists: [{ id: "a".repeat(22), name: slug }],
    anchorArtistIds: ["a".repeat(22)],
    collaborationArtistIds: [],
    albumIds: ["b".repeat(22)],
    sourceUrls: ["https://example.com/evidence"],
  };
  const context = { festivalSlug: slug, editionYear: 2027 };
  const invoke = (options = [], value = profile) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/configure-spotify-repertoire.ts", ...options],
      { input: JSON.stringify(value), encoding: "utf8", timeout: 20000, env: process.env },
    );
  const args = ["--festival", slug, "--year", "2027"];
  try {
    const before = await db.artist.findUniqueOrThrow({ where: { id: artist.id } });
    assert.notEqual(invoke([...args, "--apply"]).status, 0);
    assert.equal(await db.operationalState.count({ where: { key: { contains: slug } } }), 0);
    await db.lineupEntry.create({
      data: { editionId: current.id, artistId: artist.id, billing: "LINEUP", position: 0 },
    });
    assert.equal(invoke(args).status, 0);
    assert.equal(await db.operationalState.count({ where: { key: { contains: slug } } }), 0);
    const applied = invoke([...args, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(applied.stdout).edition, context);
    assert.equal(await db.operationalState.count({ where: { key: { contains: slug } } }), 3);
    assert.equal(
      await db.operationalState.count({ where: { key: "spotify-repertoire-binding:" + slug } }),
      0,
    );
    assert.equal(invoke(["--apply", ...args]).status, 0);
    assert.equal(await db.operationalState.count({ where: { key: { contains: slug } } }), 3);
    const audit = await db.operationalState.findUniqueOrThrow({
      where: {
        key: "spotify-repertoire-edition-audit:" + slug + ":2027:" + profile.key,
      },
    });
    assert.deepEqual(audit.payload.edition, context);
    assert.equal(audit.payload.providerWrites, 0);
    assert.deepEqual(
      (await festivalSpotifyArtists(db, [slug], context)).spotifyRepertoireProfiles[slug],
      profile,
    );
    for (const context of [
      undefined,
      { festivalSlug: slug, editionYear: 2028 },
      { festivalSlug: "other", editionYear: 2027 },
    ])
      assert.deepEqual(
        (await festivalSpotifyArtists(db, [slug], context)).spotifyRepertoireProfiles,
        {},
      );
    for (const invalid of [
      ["--festival", slug],
      ["--year", "2027"],
      ["--festival", slug, "--year", "2028"],
      [...args, "--year", "2027"],
    ])
      assert.notEqual(invoke([...invalid, "--apply"]).status, 0);
    assert.notEqual(invoke([...args, "--apply"], { ...profile, key: slug + ":v2" }).status, 0);
    assert.deepEqual(await db.artist.findUniqueOrThrow({ where: { id: artist.id } }), before);
    assert.equal(await db.lineupEntry.count({ where: { editionId: current.id } }), 1);
    // A corrupted scoped binding rejects discovery instead of falling back to a fuzzy search.
    await db.operationalState.update({
      where: { key: repertoireBindingKey(slug, context) },
      data: { payload: { profileKey: "nonexistent:v1" } },
    });
    await assert.rejects(festivalSpotifyArtists(db, [slug], context));
  } finally {
    await db.operationalState.deleteMany({ where: { key: { contains: slug } } });
    await db.festival.delete({ where: { id: festival.id } });
    await db.artist.delete({ where: { id: artist.id } });
  }
});

test("DB-owned restrictions publish atomically and reach both canonical entrypoints", async () => {
  const { publishArtistTrackPolicy } =
    await import("../lib/catalog/artist-track-policy-repository.ts");
  const { selectionArtists } = await import("../lib/catalog/selection-artists.ts");
  const { trackPolicyKey } = await import("../lib/catalog/spotify-repertoire.ts");
  const slug = "test-track-policy-" + randomUUID();
  const artist = await db.artist.create({
    data: {
      slug,
      name: slug,
      aliases: [slug + " billing"],
      genres: [],
      topTracks: [],
      recentSetlists: [],
      freshness: {},
      identityState: "UNRESOLVED",
    },
  });
  const policy = {
    schemaVersion: 1,
    excluded: true,
    reviewedOriginal: false,
    strictPrimary: true,
    blockedPrimaryNames: [],
    blockedVersionHints: [],
  };
  const input = {
    slug,
    policy,
    actorLabel: "test",
    evidence: "Synthetic verification",
    sourceUrls: ["https://example.test/evidence"],
  };
  const audits = () => db.adminAuditEntry.count({ where: { resourceKey: slug } });
  try {
    await publishArtistTrackPolicy(db, input);
    assert.equal(
      await db.operationalState.findUnique({ where: { key: trackPolicyKey(slug) } }),
      null,
    );
    assert.equal(await audits(), 0);
    // Fail inside the real serializable transaction after insertion: it must roll back.
    const broken = {
      $transaction: (fn, options) =>
        db.$transaction(
          (tx) =>
            fn({
              artist: tx.artist,
              operationalState: tx.operationalState,
              adminAuditEntry: {
                create: () => {
                  throw new Error("synthetic audit failure");
                },
              },
            }),
          options,
        ),
    };
    await assert.rejects(publishArtistTrackPolicy(broken, input, true), /synthetic audit failure/);
    assert.equal(
      await db.operationalState.findUnique({ where: { key: trackPolicyKey(slug) } }),
      null,
    );
    assert.equal(await audits(), 0);
    await publishArtistTrackPolicy(db, input, true);
    const stored = await db.operationalState.findUniqueOrThrow({
      where: { key: trackPolicyKey(slug) },
    });
    assert.deepEqual(stored.payload, policy);
    assert.equal(await audits(), 1);
    await publishArtistTrackPolicy(db, input, true);
    assert.deepEqual(await db.operationalState.findUnique({ where: { key: stored.key } }), stored);
    assert.equal(await audits(), 1);
    await assert.rejects(
      publishArtistTrackPolicy(
        db,
        {
          ...input,
          policy: { ...policy, excluded: false },
        },
        true,
      ),
      /conflict/,
    );
    assert.deepEqual((await selectionArtists(db, [slug + " billing"]))[0].trackPolicy, policy);
    assert.deepEqual((await festivalSpotifyArtists(db, [slug])).spotifyTrackPolicies[slug], policy);
    assert.deepEqual(await db.artist.findUniqueOrThrow({ where: { id: artist.id } }), artist);
    await assert.rejects(
      publishArtistTrackPolicy(
        db,
        {
          ...input,
          edition: { festivalSlug: slug, editionYear: 2027 },
        },
        true,
      ),
      /current edition/,
    );
  } finally {
    await db.operationalState.deleteMany({ where: { key: { contains: slug } } });
    await db.artist.delete({ where: { id: artist.id } });
    // Append-only audit remains in the disposable DB, removed with its container.
  }
});
