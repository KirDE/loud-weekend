import assert from "node:assert/strict";
import test from "node:test";
import { collectionsForSelection, mergeCollections, readCollections } from "../lib/collections.ts";
import { parsePlannerState } from "../lib/planner-storage.ts";
import { playlistLineup } from "../lib/playlist-selection.ts";

test("artist exclusion is opt-in, can be cleared, and preserves legacy updates", () => {
  const remote = readCollections({
    playlistFestivals: ["fest"],
    playlistExcludedArtists: ["first"],
  });
  assert.deepEqual(
    collectionsForSelection(remote, { playlistFestivals: ["other"] }).playlistExcludedArtists,
    ["first"],
  );
  assert.deepEqual(
    collectionsForSelection(remote, { playlistFestivals: ["fest"], playlistExcludedArtists: [] })
      .playlistExcludedArtists,
    [],
  );
  assert.deepEqual(
    mergeCollections(remote, {
      playlistFestivals: ["other"],
      playlistExcludedArtists: ["second", "first"],
    }).playlistExcludedArtists,
    ["first", "second"],
  );
  assert.deepEqual(
    parsePlannerState('{"playlistFestivals":["fest"],"playlistExcludedArtists":["first","first"]}')
      .playlistExcludedArtists,
    ["first"],
  );
  assert.equal(
    parsePlannerState('{"playlistExcludedArtists":[" invalid "]}').playlistExcludedArtists,
    undefined,
  );
});

test("multiple selected current lineups deduplicate canonical artists", () => {
  const lineups = {
    artistSlugsByFestival: { one: ["artist-a", "artist-b"], two: ["artist-a", "artist-c"] },
    legacyFavoriteSlugs: {},
  };
  const artists = ["a", "b", "c", "d"].map((letter) => ({
    slug: "artist-" + letter,
    name: letter,
  }));
  assert.deepEqual(playlistLineup(["one", "two"], lineups, artists), artists.slice(0, 3));
});
