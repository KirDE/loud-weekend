import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../lib/prisma-client.mjs';
import { validateDisposableDatabase } from '../scripts/prepare-test-db.mjs';

validateDisposableDatabase(process.env.DATABASE_URL);
test('explicit URL/schema overrides, UTC-naive timestamps, rollback and reconnect survive the adapter migration', async () => {
  const db = createPrismaClient();
  const schema = 'adapter_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '3');
  const scoped = createPrismaClient({ url: url.toString() });
  const sentinel = new Error('rollback sentinel');
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."OperationalState" (LIKE public."OperationalState" INCLUDING ALL)`);
    assert.equal(await scoped.operationalState.count(), 0);
    await scoped.operationalState.create({data: {key: 'scoped', payload: {ok: true}}});
    assert.equal(await db.operationalState.findUnique({where: {key: 'scoped'}}), null);
    await assert.rejects(scoped.$transaction(async tx => {
      await tx.operationalState.update({where: {key: 'scoped'}, data: {payload: {ok: false}}});
      throw sentinel;
    }), error => error === sentinel);
    await scoped.$disconnect();
    assert.deepEqual((await scoped.operationalState.findUniqueOrThrow({where: {key: 'scoped'}})).payload, {ok: true});
    for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York']) {
      await scoped.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        await tx.$executeRawUnsafe('CREATE TEMP TABLE adapter_timestamp_probe (at timestamp(3)) ON COMMIT DROP');
        const instant = new Date('2027-07-01T01:23:45.678Z');
        await tx.$executeRaw`INSERT INTO adapter_timestamp_probe VALUES (${instant})`;
        const [actual] = await tx.$queryRaw`SELECT at FROM adapter_timestamp_probe`;
        assert.equal(actual.at.toISOString(), instant.toISOString(), zone);
      });
    }
  } finally {
    await scoped.$disconnect();
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
});
