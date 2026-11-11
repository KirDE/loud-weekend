import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** One adapter/pool per client; Prisma $disconnect owns pool shutdown. */
export function createPrismaClient({ url = process.env.DATABASE_URL, ...options } = {}) {
  // Keep imports/builds and invalid-argument CLI paths lazy, without allowing pg
  // to fall back to a local/default database when configuration is missing.
  const parsed = new URL(url || 'postgresql://missing.invalid/unconfigured');
  const schema = parsed.searchParams.get('schema') ?? 'public';
  // pg does not understand Prisma's pool/namespace URL parameters.
  const integerParameter = (name, fallback) => {
    const value = parsed.searchParams.get(name);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid database parameter: ${name}`);
    return Number(value);
  };
  const max = integerParameter('connection_limit', 10);
  // pg uses a single timeout for pool acquisition and new connections.
  const connectionTimeoutMillis = integerParameter('pool_timeout', integerParameter('connect_timeout', 10)) * 1000;
  if (max < 1) throw new Error('connection_limit must be positive');
  for (const name of ['schema', 'connection_limit', 'connect_timeout', 'pool_timeout']) parsed.searchParams.delete(name);
  const adapter = new PrismaPg({ connectionString: parsed.toString(), max, connectionTimeoutMillis }, { schema });
  if (!url) adapter.connect = async () => { throw new Error('DATABASE_URL is required to connect'); };
  return new PrismaClient({ ...options, adapter });
}
