import assert from "node:assert/strict";
import test from "node:test";
import { playlistCoverage } from "../lib/playlist-coverage.ts";

test("public playlist coverage requires both measured counts and its own sync time", () => {
  const syncedAt = new Date("2026-11-22T12:00:00.000Z");
  const valid = { artistCount: 110, trackCount: 201, syncedAt };
  assert.deepEqual(playlistCoverage(valid), {
    matchedArtists: 110,
    tracks: 201,
    recordedAt: syncedAt.toISOString(),
  });
  for (const patch of [
    { syncedAt: null },
    { artistCount: null },
    { trackCount: 0 },
    { trackCount: NaN },
  ]) {
    assert.equal(playlistCoverage({ ...valid, ...patch }), undefined);
  }
});
