import assert from "node:assert/strict";
import test from "node:test";
import { mergePlannerState } from "../lib/planner-storage.ts";

test("account merge replays device changes without dropping unrelated remote entries", () => {
  const expected = {
    favoriteFestivals: ["local", "removed"],
    favoriteArtists: ["retained"],
    attendance: { removed: "going", updated: "maybe" },
    playlistFestivals: ["removed"],
    savedFilters: { country: "DE", query: "old" },
  };
  const remote = {
    favoriteFestivals: ["local", "removed", "account"],
    favoriteArtists: ["retained", "account"],
    attendance: { removed: "going", updated: "maybe", account: "going" },
    playlistFestivals: ["removed", "account"],
    savedFilters: { country: "AT", query: "old" },
  };
  const current = {
    favoriteFestivals: ["local", "new"],
    favoriteArtists: ["new", "retained"],
    attendance: { updated: "not-going" },
    playlistFestivals: ["new"],
    savedFilters: { country: "DE", query: "new" },
  };
  const merged = mergePlannerState(current, remote, expected);
  assert.deepEqual(merged.favoriteFestivals, ["local", "account", "new"]);
  assert.deepEqual(merged.favoriteArtists, ["retained", "account", "new"]);
  assert.deepEqual(merged.attendance, { updated: "not-going", account: "going" });
  assert.deepEqual(merged.playlistFestivals, ["account", "new"]);
  assert.equal(merged.savedFilters.country, "AT");
  assert.equal(merged.savedFilters.query, "new");
});

test("a device-only partial merge still combines collections and keeps local attendance", () => {
  const current = {
    favoriteFestivals: ["local"],
    favoriteArtists: [],
    attendance: { local: "going" },
    playlistFestivals: ["local"],
    savedFilters: { query: "retained" },
  };
  const merged = mergePlannerState(current, {
    attendance: { local: "maybe", remote: "going" },
    playlistFestivals: ["remote"],
  });
  assert.deepEqual(merged.favoriteFestivals, ["local"]);
  assert.deepEqual(merged.playlistFestivals, ["local", "remote"]);
  assert.deepEqual(merged.attendance, { local: "going", remote: "going" });
  assert.equal(merged.savedFilters.query, "retained");
});
