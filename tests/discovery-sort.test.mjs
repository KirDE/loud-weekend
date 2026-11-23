import assert from "node:assert/strict";
import test from "node:test";
import { sortDiscoveryFestivals, uniqueFavoriteSlugs } from "../lib/discovery-sort.ts";

const events = [
  { slug: "wide", name: "Zulu", startDate: "2027-06-10", coordinates: { latitude: 47, longitude: 14 } },
  { slug: "near", name: "Älpha", startDate: "2027-06-12", coordinates: { latitude: 52, longitude: 13 } },
  { slug: "unknown", name: "Bravo" },
  { slug: "no-favorites", name: "Charlie", startDate: "2027-06-11", coordinates: { latitude: 50, longitude: 10 } },
];
const artists = [
  { slug: "first", name: "The Act", aliases: ["Old Act", "Shared"] },
  { slug: "second", name: "Different Act", aliases: ["Shared"] },
];
const artistSlugsByFestival = { wide: ["second", "third"], near: ["first"], "no-favorites": ["fourth"] };

function order(sort, favorites = []) {
  return sortDiscoveryFestivals(events, sort, {
    locale: "de", origin: { latitude: 52, longitude: 13 }, favorites,
    lineups: { artistSlugsByFestival, legacyFavoriteSlugs: uniqueFavoriteSlugs(artists, new Set(["first", "second"])) },
  }).map(event => event.slug);
}

test("sorts with locale-aware names, nearest distance, dates, announced act counts and unknowns last", () => {
  assert.deepEqual(order("date"), ["wide", "no-favorites", "near", "unknown"]);
  assert.deepEqual(order("name"), ["near", "unknown", "no-favorites", "wide"]);
  assert.deepEqual(order("distance"), ["near", "no-favorites", "wide", "unknown"]);
  assert.deepEqual(order("acts"), ["wide", "no-favorites", "near", "unknown"]);
});

test("matches unambiguous aliases and canonical keys, deduplicates favorites and ignores homonyms", () => {
  assert.deepEqual(order("favorites", ["Shared"]), ["wide", "no-favorites", "near", "unknown"]);
  assert.deepEqual(order("favorites", ["Old Act", "The Act", "artist:second"]),
    ["wide", "near", "no-favorites", "unknown"]);
  assert.deepEqual(order("favorites", ["artist:first"]), ["near", "wide", "no-favorites", "unknown"]);
});

test("identical names and unknown dates do not inherit backend ordering", () => {
  const rows = [{ slug: "two", name: "Same" }, { slug: "one", name: "Same" }];
  const options = { locale: "en", origin: { latitude: 0, longitude: 0 }, favorites: [] };
  assert.deepEqual(sortDiscoveryFestivals(rows, "date", options).map(event => event.slug), ["one", "two"]);
  assert.equal(rows[0].slug, "two");
});
