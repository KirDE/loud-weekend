import assert from "node:assert/strict";
import test from "node:test";
import { similarFestivals } from "../lib/planning.ts";

const anchor = {
  slug: "anchor",
  name: "Anchor",
  genres: ["Doom Metal"],
  startDate: "2027-06-10",
  endDate: "2027-06-12",
  coordinates: { latitude: 50, longitude: 10 },
};
const festivals = [
  anchor,
  { slug: "canonical", name: "Unrelated billing spelling", genres: [] },
  { slug: "homonym", name: "Same printed name", genres: [], lineup: ["Shared Act"] },
  { slug: "favorite", name: "Favorite act", genres: [] },
  { slug: "genre", name: "Matching genre", genres: [" Doom   Metal ", "DOOM METAL"] },
  {
    slug: "nearby",
    name: "Nearby dates and venue",
    genres: [],
    startDate: "2027-06-15",
    endDate: "2027-06-16",
    coordinates: { latitude: 50, longitude: 11 },
  },
  {
    slug: "date-only",
    name: "Dates only",
    genres: [],
    startDate: "2027-06-10",
    endDate: "2027-06-12",
  },
  { slug: "distance-only", name: "Coordinates only", genres: [], coordinates: anchor.coordinates },
];
const lineups = {
  artistSlugsByFestival: {
    anchor: ["shared"],
    canonical: ["shared", "shared"],
    homonym: ["other"],
    favorite: ["saved", "saved"],
  },
  legacyFavoriteSlugs: { "Saved Act": "saved" },
};

test("ranks canonical acts first and explains only observed related signals", () => {
  const results = similarFestivals(
    { ...anchor, lineup: ["Shared Act"] },
    festivals,
    {
      locale: "en",
      favorites: ["artist:saved", "Saved Act"],
      lineups,
    },
    10,
  );
  assert.deepEqual(
    results.map(({ festival }) => festival.slug),
    ["canonical", "favorite", "genre", "nearby"],
  );
  assert.equal(results[0].shared, 1);
  assert.equal(results[0].gapDays, null);
  assert.equal(results[0].distance, null);
  assert.equal(results[1].favoriteCount, 1);
  assert.deepEqual(results[2].sharedGenres, ["doom metal"]);
  assert.equal(results[3].gapDays, 3);
  assert.equal(results[3].distance, 71);
});

test("dates and distance are independent, and ties do not depend on input order", () => {
  const unknown = { slug: "none", name: "None", genres: [], lineup: ["Shared Act"] };
  assert.deepEqual(similarFestivals(unknown, festivals, { locale: "en" }), []);
  const sameName = ["b", "a"].map((slug) => ({ slug, name: "Same name", genres: anchor.genres }));
  assert.deepEqual(
    similarFestivals(anchor, sameName, { locale: "en" }).map((row) => row.festival.slug),
    ["a", "b"],
  );
  const clash = { ...anchor, slug: "clash" };
  assert.equal(similarFestivals(anchor, [clash], { locale: "en" })[0].gapDays, 0);
});
