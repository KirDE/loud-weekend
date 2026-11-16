import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { assertSpotifyPlanCurrent, withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';

// Sort object keys recursively, but retain array order (lineup order is semantic).
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const requestBytes = (input: Record<string, unknown>, checkpoint?: unknown) => Buffer.byteLength(JSON.stringify({ ...input, ...(checkpoint === undefined ? {} : { discoveryCheckpoint: checkpoint }) }));
export async function clearSpotifyDiscovery(db: PrismaClient, claim: PlaylistLease) {
  await withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    const job = await tx.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } });
    if (!job.desiredPlan) throw Error('Durable Spotify plan required before scratch cleanup');
    await tx.operationalState.deleteMany({ where: { key: `playlist-discovery:spotify:v1:${claim.id}` } });
  });
}

/** Scratch is disposable; bound retention even when a newer publication means the
 * old job is never claimed again. Run from the existing Spotify timer, also idle.
 * Never touch plans/intents or a live job; CAS protects refreshed scratch. */
export async function pruneSpotifyDiscovery(db: PrismaClient) {
  const prefix = 'playlist-discovery:spotify:v1:';
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db.$queryRaw<{ key: string }[]>`
    SELECT scratch.key FROM "OperationalState" scratch
    LEFT JOIN "CatalogPlaylistRefresh" job ON scratch.key = ${prefix} || job.id
    WHERE scratch.key LIKE ${prefix + '%'} AND scratch."updatedAt" < ${cutoff}
      AND (job.id IS NULL OR (job.status <> 'RUNNING' AND job."leaseOwner" IS NULL))
    ORDER BY scratch."updatedAt", scratch.key LIMIT 64`;
  for (const row of rows) await db.$transaction(async tx => {
    const id = row.key.slice(prefix.length);
    const job = await tx.catalogPlaylistRefresh.findUnique({ where: { id }, select: { festivalSlug: true } });
    if (job) {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(210,hashtext(${job.festivalSlug})) AS locked`;
      if (!locked) return;
      const current = await tx.catalogPlaylistRefresh.findUnique({ where: { id } });
      if (current?.status === 'RUNNING' || current?.leaseOwner) return;
    }
    await tx.operationalState.deleteMany({ where: { key: row.key, updatedAt: { lt: cutoff } } });
  });
}

/** Read-only discovery scratch, never a plan or write intent. Bound to exact inputs
 * and job; all durable changes use the existing edition/lease fence. */
export async function discoverSpotifyChunk(db: PrismaClient, claim: PlaylistLease, input: Record<string, unknown>, execute: (value: unknown) => Promise<unknown>) {
  const key = `playlist-discovery:spotify:v1:${claim.id}`;
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  const prior = await withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    return tx.operationalState.findUnique({ where: { key } });
  });
  const saved = prior?.payload as { fingerprint?: string; checkpoint?: Prisma.JsonValue } | undefined;
  if (requestBytes(input, saved?.fingerprint === fingerprint ? saved.checkpoint : undefined) > 8 * 1024 * 1024) throw Error('Discovery request too large');
  const result = await execute({ ...input, ...(saved?.fingerprint === fingerprint ? { discoveryCheckpoint: saved.checkpoint } : {}) }) as Record<string, Prisma.JsonValue>;
  if (!result || typeof result !== 'object') throw Error('Invalid discovery reply');
  if (!('discoveryCheckpoint' in result)) return result;
  if (!result.discoveryCheckpoint || Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024 || requestBytes(input, result.discoveryCheckpoint) > 8 * 1024 * 1024) throw Error('Invalid discovery checkpoint');
  await withPlaylistRefreshLease(db, claim, async tx => {
    await assertSpotifyPlanCurrent(tx, claim);
    const payload = { fingerprint, checkpoint: result.discoveryCheckpoint } as Prisma.InputJsonValue;
    await tx.operationalState.upsert({ where: { key }, create: { key, payload }, update: { payload } });
  });
  throw Object.assign(new Error('Spotify discovery checkpoint saved'), { code: 'SPOTIFY_DISCOVERY_CHECKPOINT' });
}
