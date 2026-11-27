import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelectionPlaylist,
  deduplicateArtists,
  SelectionPlaylistRateLimit,
  SelectionPlaylistWriteUnconfirmed,
} from "../lib/selection-playlist.ts";
import { festivalSpotifyArtists, matchSelectionArtists } from "../lib/catalog/selection-artists.ts";
import { parsePlannerState, serializePlannerState } from "../lib/planner-storage.ts";

const id = (letter) => letter.repeat(22);
const artist = (name, letter, extra = {}) => ({
  requestedName: name,
  name,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  spotifyId: id(letter),
  ...extra,
});
const track = (letter, name, credits, extra = {}) => ({
  id: id(letter),
  uri: "spotify:track:" + id(letter),
  name,
  duration_ms: 180000,
  popularity: 50,
  is_playable: true,
  artists: credits.map(([letter, name]) => ({ id: id(letter), name })),
  album: { id: id("R") },
  ...extra,
});
function mock(pools = {}, extra = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    const match = new URL(url).pathname.match(/^\/v1\/artists\/([^/]+)\/top-tracks$/);
    if (match) return Response.json({ tracks: pools[match[1]] ?? [] });
    if (url.includes("/albums/"))
      return Response.json({
        items: (extra.albumTracks ?? []).map((t) => ({ id: t.id })),
        next: null,
      });
    if (url.includes("/v1/tracks?")) return Response.json({ tracks: extra.albumTracks ?? [] });
    if (url.includes("/users/"))
      return Response.json({
        id: id("P"),
        external_urls: { spotify: "https://open.spotify.com/playlist/" + id("P") },
      });
    if (url.includes("/playlists/")) return Response.json({ snapshot_id: "synthetic" });
    throw new Error("Unexpected provider call: " + url);
  };
  return { calls, request };
}
const run = (canonicalArtists, m, extra = {}) =>
  createSelectionPlaylist({
    token: "synthetic",
    spotifyUserId: "synthetic",
    artists: canonicalArtists.map((a) => a.requestedName),
    canonicalArtists,
    festivals: ["Synthetic festival"],
    request: m.request,
    ...extra,
  });
const writes = (m) => m.calls.filter((c) => c.init?.method === "POST");
test("deduplicates artist labels case-insensitively and preserves order", () => {
  assert.deepEqual(deduplicateArtists([" Ghost ", "ghost", "Gojira", ""]), ["Ghost", "Gojira"]);
});
test(
  "uses canonical IDs, never first-result search; rejects tribu" +
    "te/homonym, wrong primary, short and wrong-version tracks",
  async () => {
    const good = track("t", "Valid studio song", [["G", "Ghost"]]);
    const m = mock({
      [id("G")]: [
        track("a", "Karaoke cover", [["X", "Ghost Tribute"]], {
          duration_ms: 30000,
          popularity: 100,
        }),
        track("b", "Same-name homonym", [["X", "Ghost"]]),
        track("c", "Featured wrong primary", [
          ["X", "Other"],
          ["G", "Ghost"],
        ]),
        track("d", "Too short", [["G", "Ghost"]], { duration_ms: 89000 }),
        track("e", "Song (Live)", [["G", "Ghost"]]),
        track("f", "Song - Remix", [["G", "Ghost"]]),
        track("g", "Song - Karaoke Version", [["G", "Ghost"]]),
        good,
      ],
    });
    const result = await run([artist("Ghost", "G")], m);
    assert.equal(result.trackCount, 1);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(JSON.parse(writes(m).at(-1).init.body).uris, [good.uri]);
    assert(m.calls.every((c) => !c.url.includes("/search")));
  },
);
test(
  "canonical aliases count once; ambiguous and unmatched labels" +
    " remain unresolved without provider search",
  async () => {
    const rows = [
      { id: "a", slug: "ghost", name: "Ghost", aliases: ["Ghost Alias"] },
      { id: "b", slug: "other", name: "Other", aliases: ["Ghost"] },
    ];
    assert.equal(matchSelectionArtists(rows, ["Ghost"])[0].artist, null);
    assert.equal(matchSelectionArtists(rows, ["Ghost Alias"])[0].artist.slug, "ghost");
    const m = mock({ [id("G")]: [track("t", "A song", [["G", "Ghost"]])] });
    const a = artist("Ghost", "G"),
      alias = { ...a, requestedName: "Ghost Alias" };
    const result = await run(
      [a, alias, { requestedName: "Unknown", name: "Unknown", slug: null, spotifyId: null }],
      m,
    );
    assert.equal(result.artistCount, 2);
    assert.deepEqual(result.unresolved, ["Unknown"]);
    assert.equal(m.calls.filter((c) => c.url.includes("/top-tracks")).length, 1);
  },
);
test("global URI/song dedup chooses another eligible song instead of duplicating a version", async () => {
  const m = mock({
    [id("G")]: [track("a", "Shared song", [["G", "Ghost"]])],
    [id("J")]: [
      track("b", "Shared song - Remastered", [["J", "Gojira"]], { popularity: 100 }),
      track("c", "Different song", [["J", "Gojira"]]),
    ],
  });
  const result = await run([artist("Ghost", "G"), artist("Gojira", "J")], m);
  assert.equal(result.trackCount, 2);
  assert.deepEqual(JSON.parse(writes(m).at(-1).init.body).uris, [
    "spotify:track:" + id("a"),
    "spotify:track:" + id("c"),
  ]);
});
const profile = {
  schemaVersion: 1,
  key: "synthetic-repertoire",
  artistSlugs: ["composite", "second-composite"],
  setlistArtist: "Composite",
  searchArtists: [
    { id: id("A"), name: "Anchor" },
    { id: id("C"), name: "Collaborator" },
  ],
  anchorArtistIds: [id("A")],
  collaborationArtistIds: [id("C")],
  albumIds: [id("R")],
  sourceUrls: ["https://evidence.example.test/release"],
};
test("reviewed repertoire rejects unrelated solo/primary credits and shares one global URI budget", async () => {
  const reviewed = track("r", "Reviewed album song", [["A", "Anchor"]]);
  const unrelated = track("u", "Unrelated project", [["A", "Anchor"]], {
    album: { id: id("U") },
    popularity: 100,
  });
  const wrongPrimary = track(
    "w",
    "Wrong primary",
    [
      ["X", "Unknown"],
      ["A", "Anchor"],
    ],
    { popularity: 100 },
  );
  const m = mock({ [id("A")]: [unrelated, wrongPrimary] }, { albumTracks: [reviewed] });
  const composite = artist("Composite", "A", {
    slug: "composite",
    spotifyId: null,
    repertoire: profile,
  });
  const other = {
    ...composite,
    requestedName: "Second Composite",
    name: "Second Composite",
    slug: "second-composite",
  };
  const result = await run([composite, other], m);
  assert.equal(result.trackCount, 1);
  assert.deepEqual(result.unresolved, ["Second Composite"]);
  assert.deepEqual(JSON.parse(writes(m).at(-1).init.body).uris, [reviewed.uri]);
});
test(
  "all unresolved, provider read failure, and malformed provide" +
    "r replies create no playlist and retain local fallback",
  async () => {
    const unknown = { requestedName: "Unknown", name: "Unknown", slug: null, spotifyId: null },
      empty = mock();
    await assert.rejects(run([unknown], empty), /could not resolve/);
    assert.equal(empty.calls.length, 0);
    for (const response of [
      new Response("failed", { status: 503 }),
      Response.json({ unexpected: "schema" }),
    ]) {
      const calls = [],
        request = async (url, init) => {
          calls.push({ url, init });
          return response;
        };
      await assert.rejects(run([artist("Ghost", "G")], { request, calls }));
      assert.equal(
        calls.some((c) => c.init?.method === "POST"),
        false,
      );
    }
    const state = {
      favoriteFestivals: [],
      favoriteArtists: [],
      attendance: {},
      playlistFestivals: ["wacken-open-air", "graspop"],
    };
    assert.deepEqual(
      parsePlannerState(serializePlannerState(state)).playlistFestivals,
      state.playlistFestivals,
    );
  },
);

test("reviewed primary identity accepts non-Latin and stop-word-only names through the real RPC", async () => {
  for (const name of ["Молчат Дома", "The The"]) {
    const m = mock({
      [id("G")]: [track("t", "Valid studio song", [["G", "Provider Display Alias"]])],
    });
    const result = await run([artist(name, "G")], m);
    assert.equal(result.trackCount, 1);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(JSON.parse(writes(m).at(-1).init.body).uris, ["spotify:track:" + id("t")]);
  }
});

test("reviewed original identities bypass vague tribute-name hints but not explicit tribute exclusions", async () => {
  for (const name of ["Attack Attack!", "Sex Pistols", "Ozzy Osbourne", "Massive Attack"]) {
    const m = mock({ [id("G")]: [track("t", "Eligible studio song", [["G", name]])] });
    const result = await run([artist(name, "G")], m);
    assert.equal(result.trackCount, 1);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(JSON.parse(writes(m).at(-1).init.body).uris, ["spotify:track:" + id("t")]);
  }
  for (const name of ["Ultimate Ozzy", "ultimate ozzy", "Korn Again", "Tribute to Example"]) {
    const m = mock({ [id("G")]: [track("t", "Eligible studio song", [["G", name]])] });
    await assert.rejects(run([artist(name, "G")], m), /could not resolve/);
    assert.equal(writes(m).length, 0);
  }
});

test("preview and deep modes add only eligible unique tracks in artist rounds", async () => {
  const primary = Array.from({ length: 9 }, (_, index) =>
    track(String(index), `Original song ${index}`, [["G", "Ghost"]], { popularity: 90 - index }),
  );
  const second = track("q", "Original song 1 - Remastered", [["J", "Gojira"]]);
  for (const [depth, expected] of [
    ["quick", 2],
    ["preview", 5],
    ["deep", 9],
  ]) {
    const m = mock({
      [id("G")]: [...primary, track("s", "Karaoke cover", [["X", "Ghost Tribute"]])],
      [id("J")]: [second],
    });
    const result = await run([artist("Ghost", "G"), artist("Gojira", "J")], m, { depth });
    const uris = JSON.parse(writes(m).at(-1).init.body).uris;
    assert.equal(result.trackCount, expected);
    assert.deepEqual(result.unresolved, []);
    assert.equal(uris[0], primary[0].uri);
    assert.equal(uris[1], second.uri);
    assert.ok(!uris.includes(primary[1].uri));
    assert.equal(new Set(uris).size, uris.length);
  }
});

test("Spotify quota before creation is distinct from an uncertain track write", async () => {
  const a = artist("Ghost", "G");
  const readQuota = {
    calls: [],
    request: async (url, init) => {
      readQuota.calls.push({ url, init });
      return new Response(null, { status: 429 });
    },
  };
  await assert.rejects(run([a], readQuota, { depth: "deep" }), {
    constructor: SelectionPlaylistRateLimit,
  });
  assert.equal(writes(readQuota).length, 0);
  const select = mock({ [id("G")]: [track("a", "Studio song", [["G", "Ghost"]])] });
  const request = async (url, init) => {
    if (/\/playlists\/[^/]+\/tracks/.test(url)) {
      select.calls.push({ url, init });
      return new Response(null, { status: 429 });
    }
    return select.request(url, init);
  };
  await assert.rejects(run([a], { request }, { depth: "preview" }), {
    constructor: SelectionPlaylistWriteUnconfirmed,
  });
  assert.equal(writes(select).length, 2);
});

test("festival export preserves canonical aliases and only verified agreeing provider IDs", async () => {
  const row = {
    id: "synthetic",
    slug: "synthetic",
    name: "Canonical",
    aliases: ["Billing Alias"],
    identityState: "LINKED",
    identities: [{ provider: "spotify", externalId: id("A") }],
    links: [
      { source: "spotify", verified: true, url: "https://open.spotify.com/artist/" + id("A") },
    ],
  };
  const db = {
    artist: { findMany: async () => [row] },
    operationalState: { findMany: async () => [] },
  };
  assert.deepEqual(await festivalSpotifyArtists(db, ["Billing Alias"]), {
    aliases: { "Billing Alias": "Canonical" },
    acceptedPrimaryNames: { "Billing Alias": ["Canonical", "Billing Alias"] },
    spotifyArtistIds: { "Billing Alias": id("A") },
    spotifyRepertoireProfiles: {},
  });
  row.links[0].verified = false;
  assert.deepEqual((await festivalSpotifyArtists(db, ["Billing Alias"])).spotifyArtistIds, {});
  row.links[0].verified = true;
  row.links[0].url = "https://open.spotify.com/artist/" + id("B");
  assert.deepEqual((await festivalSpotifyArtists(db, ["Billing Alias"])).spotifyArtistIds, {});
});

test("canonical festival names retain accepted aliases without a provider pin", async () => {
  const db = {
    artist: {
      findMany: async () => [
        {
          id: "x",
          slug: "x",
          name: "Canonical",
          aliases: ["Accepted Alias"],
          identityState: "UNRESOLVED",
          identities: [],
          links: [],
        },
      ],
    },
    operationalState: { findMany: async () => [] },
  };
  const exported = await festivalSpotifyArtists(db, ["Canonical"]);
  assert.deepEqual(exported.acceptedPrimaryNames, { Canonical: ["Canonical", "Accepted Alias"] });
  assert.deepEqual(exported.spotifyArtistIds, {});
});

test("festival accepted labels exclude names owned by another canonical or archived row", async () => {
  const db = {
    artist: {
      findMany: async () => [
        {
          id: "one",
          slug: "one",
          name: "Ghost",
          aliases: ["Ghost Alias"],
          identityState: "UNRESOLVED",
          identities: [],
          links: [],
        },
        {
          id: "two",
          slug: "two",
          name: "Other",
          aliases: ["Ghost"],
          identityState: "UNRESOLVED",
          identities: [],
          links: [],
        },
      ],
    },
    operationalState: { findMany: async () => [] },
  };
  const exported = await festivalSpotifyArtists(db, ["Ghost Alias"]);
  assert.deepEqual(exported.acceptedPrimaryNames, { "Ghost Alias": ["Ghost Alias"] });
  assert.deepEqual(exported.aliases, { "Ghost Alias": "Ghost Alias" });
  assert.deepEqual(exported.spotifyArtistIds, {});
});
