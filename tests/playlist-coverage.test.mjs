import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageEvidence,
  playlistCoverage,
  spotifyCoverageCounts,
} from "../lib/playlist-coverage.ts";

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

test("Spotify counts only acts with verified report tracks, and public coverage rejects stale generations", () => {
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

test("published unmatched reasons are aggregate, generation-bound and account for all unmatched acts", () => {
  const report = [
    { artist: "Included", count: 1, tracks: ["Track"] },
    {
      artist: "Duplicate",
      count: 0,
      tracks: [],
      choice_log: [
        { skip: "no_spotify_match" },
        { skip: "duplicate_uri", matched: "Do not publish" },
      ],
      errors: [],
    },
    {
      artist: "Rejected",
      count: 0,
      tracks: [],
      choice_log: [{ skip: "artist_mismatch" }],
      errors: [],
    },
    {
      artist: "Incomplete",
      count: 0,
      tracks: [],
      choice_log: [],
      errors: ["Private provider diagnostic"],
    },
  ];
  const plan = { artists_count: 4, track_count: 1, report };
  const counts = spotifyCoverageCounts(plan);
  assert.deepEqual(counts, {
    matchedArtists: 1,
    eligibleArtists: 4,
    unmatchedReasons: { duplicateTrack: 1, noEligibleTrack: 1, lookupIncomplete: 1 },
  });
  const syncedAt = new Date("2026-11-22T12:00:00.000Z");
  const row = {
    artistCount: 4,
    trackCount: 1,
    syncedAt,
    coverageEvidence: coverageEvidence(counts, syncedAt),
  };
  assert.deepEqual(playlistCoverage(row).verified, counts);
  assert.deepEqual(
    spotifyCoverageCounts({
      ...plan,
      report: [...report.slice(0, 3), { ...report[3], errors: undefined }],
    }),
    { matchedArtists: 1, eligibleArtists: 4 },
  );
  assert.deepEqual(
    spotifyCoverageCounts({
      ...plan,
      report: [
        ...report.slice(0, 3),
        { ...report[3], errors: [], choice_log: [{ skip: "unknown" }] },
      ],
    }),
    { matchedArtists: 1, eligibleArtists: 4 },
  );
  for (const unmatchedReasons of [
    { duplicateTrack: 2 },
    { duplicateTrack: 4 },
    { duplicateTrack: 3, secret: 1 },
    { noEligibleTrack: 3, duplicateTrack: 0 },
  ]) {
    const coverage = playlistCoverage({
      ...row,
      coverageEvidence: { ...row.coverageEvidence, unmatchedReasons },
    });
    assert.deepEqual(coverage.verified, { matchedArtists: 1, eligibleArtists: 4 });
  }
});
