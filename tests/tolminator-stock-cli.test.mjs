import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const args of [['--publish'], ['--record-attempt'], ['--record-attempt', 'wrong'], ['--record-attempt', 'abcdef123', '--publish']]) {
  test(`Tolminator CLI rejects ${args.join(' ')} before DB/network`, () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/collect-tolminator-stock.ts', ...args], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, DATABASE_URL: 'invalid-sensitive-do-not-print' },
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, ''); assert.doesNotMatch(result.stderr, /invalid-sensitive/);
  });
}
test('Tolminator CLI recording requires explicit DB configuration before any request', () => {
  const env = { ...process.env }; delete env.DATABASE_URL;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/collect-tolminator-stock.ts', '--record-attempt', 'abcdef123'], {
    encoding: 'utf8', timeout: 10000, env,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /no verified refresh/);
});
