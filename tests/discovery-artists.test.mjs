import assert from "node:assert/strict";
import test from "node:test";
import {
  festivalArtistMatch,
  matchesArtistMode,
  readArtistSelection,
} from "../lib/discovery-artists.ts";
import { discoveryFromQuery, discoveryShareQuery } from "../lib/discovery-share.ts";
import { defaultDiscoveryPreferences } from "../lib/discovery-preferences.ts";

const lineups = {
  artistSlugsByFestival: {
    a: ["one", "one", "two", "three"],
    b: ["one", "two"],
    c: ["homonym"],
    d: [],
  },
  legacyFavoriteSlugs: {},
};
const selected = ["one", "two", "three"];

test("unique canonical matches support all and any without claiming unpublished lineups", () => {
  const matches = ["a", "b", "c", "d"].map((slug) =>
    festivalArtistMatch({ slug }, selected, lineups),
  );
  assert.deepEqual(
    matches.map((match) => match.matched.length),
    [3, 2, 0, 0],
  );
  assert.deepEqual(
    matches.map((match) => match.known),
    [true, true, true, false],
  );
  assert.deepEqual(
    matches.map((match) => matchesArtistMode(match, 3, "all")),
    [true, false, false, false],
  );
  assert.deepEqual(
    matches.map((match) => matchesArtistMode(match, 3, "any")),
    [true, true, false, false],
  );
  assert.deepEqual(
    matches.map((match) => matchesArtistMode(match, 0, "all")),
    [true, true, true, true],
  );
});

test("artist filters round-trip distinctly from favorite-sort snapshots and ignore malformed values", () => {
  const filters = {
    ...defaultDiscoveryPreferences,
    artistSelection: ["three", "one"],
    artistMatch: "any",
  };
  const query = discoveryShareQuery(filters);
  assert.equal(query, "filters=1&matchArtist=one&matchArtist=three&artistMatch=any");
  const parsed = discoveryFromQuery(
    new URLSearchParams(query + "&matchArtist=unknown&matchArtist=%00"),
    lineups,
  );
  assert.deepEqual(parsed.filters.artistSelection, ["one", "three"]);
  assert.equal(parsed.filters.artistMatch, "any");
  assert.deepEqual(parsed.favorites, []);
  assert.deepEqual(readArtistSelection(["one", "one", {}, "../bad", "three"]), ["one", "three"]);
});
