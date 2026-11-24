import type { PlaylistCoverage } from "./domain/festival.ts";

export function playlistCoverage(row?: {
  artistCount: number | null;
  trackCount: number | null;
  syncedAt: Date | null;
}): PlaylistCoverage | undefined {
  if (!row?.syncedAt || !Number.isFinite(row.syncedAt.valueOf())) return undefined;
  const { artistCount, trackCount } = row;
  if (
    artistCount === null ||
    trackCount === null ||
    !Number.isSafeInteger(artistCount) ||
    !Number.isSafeInteger(trackCount) ||
    artistCount < 1 ||
    trackCount < 1
  )
    return undefined;
  return {
    matchedArtists: artistCount,
    tracks: trackCount,
    recordedAt: row.syncedAt.toISOString(),
  };
}
