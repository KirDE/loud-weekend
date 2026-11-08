import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateSchedulerHealth } from '../scripts/validate-db-due-scheduler-health.mjs';
import { runTick } from '../scripts/db-due-tick.mjs';

test('bounded tick drains on idle and fetch failure; audits drain failure separately', async () => {
  for (const fetch of ['idle', 'ok', 'failed', 'oversized']) {
    const calls = [];
    const counts = await runTick(async operation => {
      calls.push(operation);
      if (operation === 'drain') return { delivered: 100 };
      if (fetch === 'failed') throw new Error('private');
      return fetch === 'idle' ? { status: 'NO_DUE_SOURCES', attempted: 0 }
        : { status: 'COMPLETED', attempted: fetch === 'ok' ? 1 : 2, fetchErrors: 0 };
    });
    assert.deepEqual(calls, ['fetch', 'drain']);
    assert.equal(counts.idle, Number(fetch === 'idle'));
    assert.equal(counts.fetch_error, Number(['failed', 'oversized'].includes(fetch)));
    assert.equal(counts.drain_ok, 1);
    assert.equal(counts.delivered, 100);
  }
  const failed = await runTick(async op => {
    if (op === 'fetch') return { status: 'NO_DUE_SOURCES', attempted: 0 };
    return { delivered: 101 };
  });
  assert.equal(failed.drain_error, 1);
  assert.equal(failed.idle, 1);
});

test('tick CLI runs from relative path and symlink; rejects overrides before touching DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-entrypoint-'));
  try {
    const link = path.join(dir, 'tick.mjs'); await symlink(path.resolve('scripts/db-due-tick.mjs'), link);
    for (const file of ['scripts/db-due-tick.mjs', link]) {
      const result = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
      assert.equal(result.status, 2, result.stderr);
      const rejected = spawnSync(process.execPath, [file, '--force'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'must-not-be-used' } });
      assert.equal(rejected.status, 2, rejected.stderr);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
