import assert from "node:assert/strict";
import test from "node:test";
import { compareFestivalLineups } from "../lib/festival-comparison.ts";

const festivals = ["a", "b", "c"].map((slug) => ({ slug, name: slug }));
const lineups = {
  artistSlugsByFestival: {
    a: ["all", "ab", "ac", "all"],
    b: ["all", "ab", "bc"],
    c: ["all", "ac", "bc"],
  },
  legacyFavoriteSlugs: {},
};

test("three-way comparison intersects each canonical pair and all three separately", () => {
  const comparison = compareFestivalLineups(festivals, lineups);
  assert.deepEqual(
    comparison.pairs.map((pair) => [pair.festivals.map((item) => item.slug), pair.shared]),
    [
      [
        ["a", "b"],
        ["all", "ab"],
      ],
      [
        ["a", "c"],
        ["all", "ac"],
      ],
      [
        ["b", "c"],
        ["all", "bc"],
      ],
    ],
  );
  assert.deepEqual(comparison.sharedAcrossAll, ["all"]);
});

test("comparison keeps no overlap separate from an unknown lineup", () => {
  const result = compareFestivalLineups(festivals, {
    ...lineups,
    artistSlugsByFestival: { a: ["artist-1"], b: ["artist-2"] },
  });
  assert.deepEqual(
    result.pairs.map((pair) => pair.shared),
    [[], null, null],
  );
  assert.equal(result.sharedAcrossAll, null);
});
