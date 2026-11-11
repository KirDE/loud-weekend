import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPrismaClient } from '../../lib/prisma-client.mjs';

// Run from an extracted archive AFTER its production-only npm ci and generation.
// No catalogue or provider changes: the intentional failure rolls back all SQL.
const require = createRequire(import.meta.url);
const versions = ['prisma', '@prisma/client', '@prisma/adapter-pg'].map(name => require(`${name}/package.json`).version);
assert.equal(new Set(versions).size, 1, 'CLI, client and adapter must match');
assert.match(versions[0], /^7\./);
const db = createPrismaClient();
const rollback = new Error('expected release acceptance rollback');
try {
  const instant = new Date('2027-07-01T01:23:45.678Z');
  await assert.rejects(db.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE prisma_release_probe (at timestamp(3) NOT NULL) ON COMMIT DROP');
    await tx.$executeRaw`INSERT INTO prisma_release_probe VALUES (${instant})`;
    const [row] = await tx.$queryRaw`SELECT at FROM prisma_release_probe`;
    assert.equal(row.at.toISOString(), instant.toISOString());
    throw rollback;
  }), error => error === rollback);
  const [state] = await db.$queryRaw`SELECT to_regclass('pg_temp.prisma_release_probe')::text AS name`;
  assert.equal(state.name, null);
  await db.festival.count();
  console.log('PRISMA_RELEASE_ACCEPTANCE: versions, adapter query, timestamp and rollback PASS');
} finally { await db.$disconnect(); }
