import type { PlaylistCoverage, PlaylistUnmatchedReasons } from "./domain/festival.ts";

type Counts = NonNullable<PlaylistCoverage["verified"]>;

export function coverageEvidence(counts: Counts, syncedAt: Date) {
  return { ...counts, recordedAt: syncedAt.toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const reasonKeys = ["noEligibleTrack", "duplicateTrack", "lookupIncomplete"] as const;

export function parseUnmatchedReasons(
  value: unknown,
  missing: number,
): PlaylistUnmatchedReasons | undefined {
  if (!isRecord(value) || !Number.isSafeInteger(missing) || missing < 1) return undefined;
  const counts: PlaylistUnmatchedReasons = {};
  let total = 0;
  for (const [key, count] of Object.entries(value)) {
    const reason = reasonKeys.find((known) => known === key);
    if (
      !reason ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > missing
    )
      return undefined;
    counts[reason] = count;
    total += count;
  }
  return total === missing ? counts : undefined;
}

const spotifyDuplicateReasons = new Set(["duplicate_uri", "duplicate_song_key"]);
const spotifyRejectionReasons = new Set([
  "no_spotify_match",
  "artist_mismatch",
  "primary_artist_mismatch",
  "artist_family_mismatch",
  "strict_primary_artist_required",
  "too_short_or_non_song",
  "bad_version",
  "soundtrack_style_version",
]);

function spotifyUnmatchedReason(
  entry: Record<string, unknown>,
): keyof PlaylistUnmatchedReasons | undefined {
  if (
    !Array.isArray(entry.errors) ||
    !entry.errors.every((error) => typeof error === "string") ||
    !Array.isArray(entry.choice_log) ||
    !entry.choice_log.every((choice) => isRecord(choice) && typeof choice.skip === "string")
  )
    return undefined;
  if (entry.errors.length) return "lookupIncomplete";
  const skips = entry.choice_log.map((choice) => choice.skip as string);
  if (
    skips.some((skip) => !spotifyDuplicateReasons.has(skip) && !spotifyRejectionReasons.has(skip))
  )
    return undefined;
  return skips.length && skips.every((skip) => spotifyDuplicateReasons.has(skip))
    ? "duplicateTrack"
    : "noEligibleTrack";
}

export function spotifyCoverageCounts(plan: Record<string, unknown>): Counts | undefined {
  const entries = plan.report;
  if (!Array.isArray(entries) || entries.length !== plan.artists_count || entries.length > 1000)
    return undefined;
  const names = new Set<string>();
  let tracks = 0;
  let matchedArtists = 0;
  const reasons: PlaylistUnmatchedReasons = {};
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
    if (entry.count) {
      matchedArtists++;
    } else {
      const reason = spotifyUnmatchedReason(entry);
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  if (!matchedArtists || tracks !== plan.track_count) return undefined;
  const unmatchedReasons = parseUnmatchedReasons(reasons, entries.length - matchedArtists);
  return {
    matchedArtists,
    eligibleArtists: entries.length,
    ...(unmatchedReasons && { unmatchedReasons }),
  };
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
    const { matchedArtists, eligibleArtists } = evidence;
    const unmatchedReasons = parseUnmatchedReasons(
      evidence.unmatchedReasons,
      eligibleArtists - matchedArtists,
    );
    coverage.verified = {
      matchedArtists,
      eligibleArtists,
      ...(unmatchedReasons && { unmatchedReasons }),
    };
  }
  return coverage;
}
