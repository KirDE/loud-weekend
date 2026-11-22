import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectRockEnSeineHiatus as collect } from '../lib/ingestion/adapters/rock-en-seine-collector.ts';
const url = 'https://www.rockenseine.com/';
const html = readFileSync(new URL('./fixtures/rock-en-seine/hiatus.html', import.meta.url), 'utf8');
function response(body = html, init = {}) {
  const r = new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
  Object.defineProperty(r, 'url', { value: url, configurable: true }); return r;
}
test('exact anonymous GET receipt re-extracts and exposes only minimized proposal', async () => {
  let calls = 0;
  const result = await collect(async (address, init) => {
    calls++; assert.equal(address, url); assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).has('cookie'), false); return response();
  });
  assert.equal(calls, 1); assert.equal(result.proposal.lifecycle, 'hiatus');
  assert.equal(result.receipt.observedAt, result.proposal.observedAt);
  assert.doesNotMatch(JSON.stringify(result.proposal), /<html|ticketStatus|actor|cookie/i);
});
test('HTTP/redirect/type/schema/body/UTF8 errors are errors, never healthy empty', async () => {
  for (const r of [response(html, { status: 403 }), response(html, { status: 206 }),
    response(html, { headers: { 'content-type': 'application/json' } }),
    response(html, { headers: { 'content-type': 'text/html; charset=latin1' } }),
    response('changed'), response('x'.repeat(2_000_001)), response(new Uint8Array([0xff]))]) {
    await assert.rejects(collect(async () => r));
  }
  const foreign = response(); Object.defineProperty(foreign, 'url', { value: 'https://foreign.invalid/' });
  await assert.rejects(collect(async () => foreign));
  await assert.rejects(collect(async () => { throw new Error('network'); }));
});
test('one shared deadline bounds stalled fetch and stalled body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingFetch = collect(async () => new Promise(() => {}));
  const rejectedFetch = assert.rejects(pendingFetch, /deadline/);
  t.mock.timers.tick(20_000); await rejectedFetch;
  let cancelled = false;
  const pendingBody = collect(async () => response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve(); await Promise.resolve();
  const rejectedBody = assert.rejects(pendingBody, /deadline/);
  t.mock.timers.tick(20_000); await rejectedBody;
  assert.equal(cancelled, true);
});
