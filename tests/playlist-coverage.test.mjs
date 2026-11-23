import assert from "node:assert/strict";
import test from "node:test";
import { playlistCoverage } from "../lib/playlist-coverage.ts";

test("public playlist coverage requires both measured counts and its own sync time", () => {
  const syncedAt = new Date("2026-11-22T12:00:00.000Z");
  const valid = { artistCount: 110, trackCount: 201, syncedAt };
  assert.deepEqual(playlistCoverage(valid), {
    reportedArtists: 110,
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

test("Spotify counts verified report tracks and rejects stale coverage", async () => {
  const { coverageEvidence, spotifyCoverageCounts } = await import("../lib/playlist-coverage.ts");
  const report = [
    { artist: "First", count: 2, tracks: ["First - One", "First - Two"] },
    { artist: "Second", count: 0, tracks: [] },
  ];
  const plan = { artists_count: 2, track_count: 2, report };
  const counts = spotifyCoverageCounts(plan);
  assert.deepEqual(counts, { eligibleArtists: 2, matchedArtists: 1 });
  assert.equal(spotifyCoverageCounts({ ...plan, track_count: 3 }), undefined);
  assert.equal(
    spotifyCoverageCounts({ ...plan, report: [report[0], { ...report[1], artist: "First" }] }),
    undefined,
  );
  const syncedAt = new Date("2026-11-22T12:00:00.000Z");
  const row = {
    artistCount: 2,
    trackCount: 2,
    syncedAt,
    coverageEvidence: coverageEvidence(counts, syncedAt),
  };
  assert.deepEqual(playlistCoverage(row).verified, counts);
  assert.equal(
    playlistCoverage({ ...row, syncedAt: new Date("2026-11-22T12:00:01.000Z") }).verified,
    undefined,
  );
});
