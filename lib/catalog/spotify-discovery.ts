import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { assertSpotifyPlanCurrent, withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';

/** Read-only discovery scratch, never a plan or write intent. Bound to exact inputs
 * and job; all durable changes use the existing edition/lease fence. */
export async function discoverSpotifyChunk(db: PrismaClient, claim: PlaylistLease, input: Record<string, unknown>, execute: (value: unknown) => Promise<unknown>) {
  const key = `playlist-discovery:spotify:v1:${claim.id}`;
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const prior = await withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    return tx.operationalState.findUnique({ where: { key } });
  });
  const saved = prior?.payload as { fingerprint?: string; checkpoint?: Prisma.JsonValue } | undefined;
  const result = await execute({ ...input, ...(saved?.fingerprint === fingerprint ? { discoveryCheckpoint: saved.checkpoint } : {}) }) as Record<string, Prisma.JsonValue>;
  if (!result || typeof result !== 'object') throw Error('Invalid discovery reply');
  if (!('discoveryCheckpoint' in result)) return result;
  if (!result.discoveryCheckpoint || JSON.stringify(result).length > 4 * 1024 * 1024) throw Error('Invalid discovery checkpoint');
  await withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    const payload = { fingerprint, checkpoint: result.discoveryCheckpoint } as Prisma.InputJsonValue;
    await tx.operationalState.upsert({ where: { key }, create: { key, payload }, update: { payload } });
  });
  throw Object.assign(new Error('Spotify discovery checkpoint saved'), { code: 'SPOTIFY_DISCOVERY_CHECKPOINT' });
}
