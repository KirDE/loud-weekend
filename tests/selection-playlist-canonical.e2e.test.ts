import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { selectionArtists } from "../lib/catalog/selection-artists.ts";
import { createSelectionPlaylist } from "../lib/selection-playlist.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient(),
  suffix = randomUUID(),
  created: string[] = [],
  keys: string[] = [];
// Shared disposable DB fixture: this is not a production cutover.
test.before(async () => {
  await db.operationalState.upsert({
    where: { key: "spotify-track-policy-migration:v1" },
    create: {
      key: "spotify-track-policy-migration:v1",
      payload: { schemaVersion: 1, ready: true },
    },
    update: {},
  });
});

const providerId = () => randomUUID().replaceAll("-", "").slice(0, 22);
async function artist(name: string, verified = false, alias: string[] = []) {
  const id = providerId(),
    slug = "selection-" + randomUUID();
  const row = await db.artist.create({
    data: {
      slug,
      name,
      aliases: alias,
      genres: [],
      identityState: "LINKED",
      topTracks: [],
      recentSetlists: [],
      freshness: {},
      identities: { create: { provider: "spotify", externalId: id } },
      links: {
        create: {
          label: "Spotify",
          source: "spotify",
          url: "https://open.spotify.com/artist/" + id,
          verified,
        },
      },
    },
  });
  created.push(row.id);
  return { ...row, providerId: id };
}
test.after(async () => {
  await db.operationalState.deleteMany({ where: { key: { in: keys } } });
  await db.artist.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});
test("canonical DB identity/verified link and alias drive selection without fuzzy provider search", async () => {
  const name = "Synthetic Selection " + suffix,
    alias = "Synthetic Alias " + suffix,
    row = await artist(name, true, [alias]);
  const requested = [alias, alias, alias.toLowerCase(), name];
  const resolved = await selectionArtists(db, requested);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].spotifyId, row.providerId);
  assert.equal(resolved[0].name, name);
  const trackId = providerId(),
    calls: { url: string; method?: string }[] = [];
  const value = await createSelectionPlaylist({
    token: "synthetic",
    spotifyUserId: "synthetic",
    artists: requested,
    festivals: ["Synthetic"],
    canonicalArtists: resolved,
    request: async (url, init) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/artists/" + row.providerId + "/top-tracks"))
        return Response.json({
          tracks: [
            {
              id: trackId,
              uri: "spotify:track:" + trackId,
              name: "Synthetic verified song",
              duration_ms: 180000,
              artists: [{ id: row.providerId, name }],
              popularity: 1,
            },
          ],
        });
      if (url.includes("/users/"))
        return Response.json({
          id: "P".repeat(22),
          external_urls: { spotify: "https://open.spotify.com/playlist/" + "P".repeat(22) },
        });
      if (init?.method === "POST") return Response.json({ snapshot_id: "synthetic" });
      throw new Error("Unexpected Spotify request");
    },
  });
  assert.equal(value.trackCount, 1);
  assert.deepEqual(value.unresolved, []);
  assert(calls.every((c) => !c.url.includes("/search")));
});
test(
  "DB alias ambiguity and LINKED without verified provider agre" +
    "ement remain unresolved before provider work",
  async () => {
    const alias = "Synthetic Shared Alias " + suffix;
    await artist("Synthetic First " + suffix, true, [alias]);
    await artist("Synthetic Second " + suffix, true, [alias]);
    const unverified = await artist("Synthetic Unverified " + suffix, false);
    const resolved = await selectionArtists(db, [
      alias,
      unverified.name,
      "Synthetic Missing " + suffix,
    ]);
    assert(resolved.every((a) => a.spotifyId === null && a.repertoire === undefined));
    let calls = 0;
    await assert.rejects(
      createSelectionPlaylist({
        token: "synthetic",
        spotifyUserId: "synthetic",
        artists: resolved.map((a) => a.requestedName),
        festivals: ["Synthetic"],
        canonicalArtists: resolved,
        request: async () => {
          calls++;
          throw new Error("Must not call provider");
        },
      }),
      /could not resolve/,
    );
    assert.equal(calls, 0);
  },
);
test(
  "durable repertoire binding is transported without merging ar" +
    "tist identities and invalid bindings fail closed",
  async () => {
    const row = await artist("Synthetic Composite " + suffix, false),
      key = "selection-" + suffix;
    const profile = {
      schemaVersion: 1,
      key,
      artistSlugs: [row.slug],
      setlistArtist: row.name,
      searchArtists: [
        { id: providerId(), name: "Synthetic Anchor" },
        { id: providerId(), name: "Synthetic Collaborator" },
      ],
      anchorArtistIds: [] as string[],
      collaborationArtistIds: [] as string[],
      albumIds: [providerId()],
      sourceUrls: ["https://evidence.example.test/reviewed-release"],
    };
    profile.anchorArtistIds = [profile.searchArtists[0].id];
    profile.collaborationArtistIds = [profile.searchArtists[1].id];
    const profileKey = "spotify-repertoire-profile:" + key,
      bindingKey = "spotify-repertoire-binding:" + row.slug;
    keys.push(profileKey, bindingKey);
    await db.operationalState.create({ data: { key: profileKey, payload: profile } });
    await db.operationalState.create({ data: { key: bindingKey, payload: { profileKey: key } } });
    const [resolved] = await selectionArtists(db, [row.name]);
    assert.deepEqual(resolved.repertoire, profile);
    assert.equal(resolved.spotifyId, null);
    await db.operationalState.update({
      where: { key: profileKey },
      data: { payload: { ...profile, artistSlugs: ["different-reviewed-act"] } },
    });
    await assert.rejects(
      selectionArtists(db, [row.name]),
      /Missing or mismatched repertoire binding/,
    );
  },
);
