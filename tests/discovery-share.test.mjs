import assert from "node:assert/strict";
import test from "node:test";
import { discoveryFromQuery, discoveryShareQuery, shareableFavoriteSlugs } from "../lib/discovery-share.ts";
import { defaultDiscoveryPreferences } from "../lib/discovery-preferences.ts";

const lineups = {
  artistSlugsByFestival: { fest: ["sample-artist", "second-artist"] },
  legacyFavoriteSlugs: { "Sample Artist": "sample-artist" },
};

test("shared snapshots round-trip public filters and canonical artist choices", () => {
  const filters = {
    ...defaultDiscoveryPreferences, query: "Rock & metal", country: "DE", month: "06", genre: "Hard Rock",
    origin: "prague", maxDistance: "500", sort: "favorites", ticketsOnly: true, announcedOnly: true,
    dateFrom: "2027-06-12", dateTo: "2027-06-13", weekendOnly: true, maxDays: "3",
  };
  const artists = shareableFavoriteSlugs(["artist:second-artist", "Sample Artist", "artist:sample-artist", "artist:not-current"], lineups);
  assert.deepEqual(artists, ["sample-artist", "second-artist"]);
  const query = discoveryShareQuery(filters, artists);
  const shared = discoveryFromQuery(new URLSearchParams(query), lineups);
  assert.deepEqual(shared, { filters, favorites: ["artist:sample-artist", "artist:second-artist"] });
  assert.equal(discoveryShareQuery(shared.filters, artists.toReversed()), query);
});

test("invalid, oversized or unrelated query values never replace saved preferences", () => {
  assert.equal(discoveryFromQuery(new URLSearchParams("dateFrom=2027-06-12&other=yes"), lineups), null);
  const invalid = new URLSearchParams({
    filters: "1", q: "x".repeat(121), genre: "a".repeat(81), country: "de", month: "13", origin: "__proto__",
    radius: "-1", sort: "unknown", announcedOnly: "true", ticketsOnly: "yes",
    dateFrom: "2027-07-01", dateTo: "2027-06-01", maxDays: "0", artist: "not-current",
  });
  assert.deepEqual(discoveryFromQuery(invalid, lineups), { filters: defaultDiscoveryPreferences, favorites: [] });
  const invalidArtists = new URLSearchParams("filters=1&sort=favorites&artist=unlisted&artist=sample-artist");
  assert.deepEqual(discoveryFromQuery(invalidArtists, lineups).favorites, ["artist:sample-artist"]);
  Array.from({ length: 100 }, () => invalidArtists.append("artist", "sample-artist"));
  assert.deepEqual(discoveryFromQuery(invalidArtists, lineups).favorites, []);
});
