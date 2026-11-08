import type { Prisma, PrismaClient } from '@prisma/client';
import { assertSpotifyPlanCurrent, withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';

export type ProviderPlaylistResult = { url: string; artists: number; tracks: number; expectedUrl?: string };

/** Publish a fully read-back Spotify result even while YouTube awaits quota.
 * Keep the same durable track plan and verified creation ID on every retry.
 * This checkpoint never marks the two-provider job complete.
 */
export async function publishSpotifyCheckpoint(db: PrismaClient, claim: PlaylistLease, result: ProviderPlaylistResult): Promise<ProviderPlaylistResult> {
  if (!/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(result.url)
    || !Number.isSafeInteger(result.tracks) || result.tracks < 1
    || !Number.isSafeInteger(result.artists) || result.artists < 1) throw new Error('Invalid Spotify read-back');
  return withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    const publication = await tx.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId } });
    const edition = await tx.festivalEdition.findFirstOrThrow({ where: { festival: { slug: claim.festivalSlug }, year: publication.editionYear, recordState: 'CURRENT' }, select: { id: true } });
    const row = await tx.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id }, select: { desiredPlan: true, spotifyCreation: true } });
    const plan = row.desiredPlan as Record<string, Prisma.JsonValue> | null;
    const expected = result.expectedUrl ?? result.url;
    if (!plan || plan.edition_year !== publication.editionYear || plan.track_count !== result.tracks || plan.artists_count !== result.artists
      || !Array.isArray(plan.track_uris) || plan.track_uris.length !== result.tracks
      || plan.playlist_url !== (['', 'NEW'].includes(expected) ? '' : expected)) throw new Error('Spotify checkpoint plan mismatch');
    const current = await tx.festivalPlaylist.findUnique({ where: { editionId_provider: { editionId: edition.id, provider: 'spotify' } } });
    if ((current?.url ?? '') !== expected) throw new Error('Playlist binding changed during checkpoint');
    if (expected !== result.url) {
      const creation = row.spotifyCreation as { sent?: boolean; playlistId?: string } | null;
      if (!['', 'NEW'].includes(expected) || !creation?.sent || result.url !== `https://open.spotify.com/playlist/${creation.playlistId}`) throw new Error('Unverified Spotify checkpoint creation');
    }
    const data = { url: result.url, artistCount: result.artists, trackCount: result.tracks, syncedAt: new Date() };
    if (current) {
      const updated = await tx.festivalPlaylist.updateMany({ where: { id: current.id, url: expected }, data });
      if (updated.count !== 1) throw new Error('Playlist binding changed during checkpoint');
    } else await tx.festivalPlaylist.create({ data: { editionId: edition.id, provider: 'spotify', ...data } });
    // Only normalize binding metadata after the provider read-back. Track URIs,
    // artist choices and the YouTube plan remain exactly as originally staged.
    await tx.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { desiredPlan: { ...plan, playlist_url: result.url, playlist_id: result.url.split('/').at(-1)! } } });
    return { ...result, expectedUrl: result.url };
  });
}

