import type { PlaylistCoverage } from "./domain/festival.ts";

type Counts = { matchedArtists: number; eligibleArtists: number };

export function coverageEvidence(counts: Counts, syncedAt: Date) {
  return { ...counts, recordedAt: syncedAt.toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function spotifyCoverageCounts(plan: Record<string, unknown>): Counts | undefined {
  const entries = plan.report;
  if (!Array.isArray(entries) || entries.length !== plan.artists_count || entries.length > 1000)
    return undefined;
  const names = new Set<string>();
  let tracks = 0;
  let matchedArtists = 0;
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.artist !== "string" ||
      !entry.artist.trim() ||
      names.has(entry.artist) ||
      typeof entry.count !== "number" ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 0 ||
      !Array.isArray(entry.tracks) ||
      entry.tracks.length !== entry.count
    )
      return undefined;
    names.add(entry.artist);
    tracks += entry.count;
    if (entry.count) matchedArtists++;
  }
  return matchedArtists && tracks === plan.track_count
    ? { matchedArtists, eligibleArtists: entries.length }
    : undefined;
}

export function playlistCoverage(row?: {
  artistCount: number | null;
  trackCount: number | null;
  syncedAt: Date | null;
  coverageEvidence?: unknown;
}): PlaylistCoverage | undefined {
  if (!row?.syncedAt || !Number.isFinite(row.syncedAt.valueOf())) return undefined;
  const { artistCount, trackCount, coverageEvidence: evidence } = row;
  if (
    artistCount === null ||
    trackCount === null ||
    !Number.isSafeInteger(artistCount) ||
    !Number.isSafeInteger(trackCount) ||
    artistCount < 1 ||
    trackCount < 1
  )
    return undefined;
  const recordedAt = row.syncedAt.toISOString();
  const coverage: PlaylistCoverage = {
    reportedArtists: artistCount,
    tracks: trackCount,
    recordedAt,
  };
  if (
    isRecord(evidence) &&
    evidence.recordedAt === recordedAt &&
    typeof evidence.matchedArtists === "number" &&
    Number.isSafeInteger(evidence.matchedArtists) &&
    typeof evidence.eligibleArtists === "number" &&
    Number.isSafeInteger(evidence.eligibleArtists) &&
    evidence.matchedArtists > 0 &&
    evidence.matchedArtists <= Math.min(artistCount, trackCount, evidence.eligibleArtists) &&
    evidence.eligibleArtists <= 1000
  ) {
    coverage.verified = {
      matchedArtists: evidence.matchedArtists,
      eligibleArtists: evidence.eligibleArtists,
    };
  }
  return coverage;
}
