import assert from "node:assert/strict";
import test from "node:test";
import { discoverySuggestionIndex, discoverySuggestions } from "../lib/discovery-suggestions.ts";

const festivals = [{ slug: "synthetic", name: "Électrique-Festival", city: "Köln", countryCode: "DE" }];
const artists = [
  { slug: "electric-callboy", name: "Electric Callboy", aliases: ["Eskimo Callboy"] },
  { slug: "callboy-other", name: "Callboy", aliases: ["Eskimo Callboy"] },
  { slug: "skald", name: "SKÁLD", aliases: [] },
];
const index = discoverySuggestionIndex(festivals, artists);

test("normalizes punctuation and accents, preserves separate canonical aliases and tolerates one typo", () => {
  const get = query => discoverySuggestions(query, index, "en");
  assert.deepEqual(get("Eskimo—Callboy").artists.map(row => row.href), ["/artists/callboy-other/", "/artists/electric-callboy/"]);
  assert.equal(get("electirc callboy").artists[0].id, "electric-callboy");
  assert.equal(get("electirc callbxy").artists.length, 0);
  assert.equal(get("skald").artists[0].id, "skald");
  assert.equal(get("electrique festival").festivals[0].id, "synthetic");
  assert.equal(get("koln").cities[0].value, "Köln");
  assert.deepEqual(get("x"), { festivals: [], artists: [], cities: [] });
});

test("large catalogues return a bounded, deterministic set per category", () => {
  const large = discoverySuggestionIndex(festivals, Array.from({ length: 3000 }, (_, index) => ({
    slug: `sample-artist-${index}`, name: `Sample Artist ${String(index).padStart(4, "0")}`, aliases: [],
  })).reverse());
  const result = discoverySuggestions("sample artist", large, "en");
  assert.deepEqual(result.artists.map(row => row.id), ["sample-artist-0", "sample-artist-1", "sample-artist-2", "sample-artist-3"]);
});
