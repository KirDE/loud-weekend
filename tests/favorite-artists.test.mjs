import assert from "node:assert/strict";
import test from "node:test";
import { favoriteArtistSlug, toggleFavoriteArtist } from "../lib/favorite-artists.ts";
import { uniqueFavoriteSlugs } from "../lib/discovery-sort.ts";

test("canonical and unambiguous legacy names share one preference; ambiguous names stay untouched", () => {
  const artists = [
    { slug: "one", name: "Artist One", aliases: ["Old Name", "Shared Name"] },
    { slug: "two", name: "Artist Two", aliases: ["Shared Name"] },
  ];
  const aliases = uniqueFavoriteSlugs(artists, new Set(["one", "two"]));
  assert.equal(favoriteArtistSlug("Old Name", aliases), "one");
  assert.equal(favoriteArtistSlug("Shared Name", aliases), undefined);
  assert.equal(favoriteArtistSlug("constructor", aliases), undefined);
  const favorites = ["artist:one", "Artist One", "Old Name", "Shared Name"];
  assert.deepEqual(toggleFavoriteArtist(favorites, "one", aliases), ["Shared Name"]);
  assert.deepEqual(toggleFavoriteArtist(["Shared Name"], "one", aliases), [
    "Shared Name",
    "artist:one",
  ]);
});
