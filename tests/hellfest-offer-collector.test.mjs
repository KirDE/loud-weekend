import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHellfestOfferObservation } from '../lib/ingestion/hellfest-offer-collector.ts';
const url = 'https://hellfest.fr/';
const response = (body = '<html>test</html>', options = {}) => {
  const r = new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...options.headers }, status: options.status ?? 200 });
  Object.defineProperty(r, 'url', { value: options.url ?? url });
  if (options.redirected) Object.defineProperty(r, 'redirected', { value: true });
  return r;
};
test('one credential-free GET on exact source; response-derived identity and timestamp', async () => {
  const before = Date.now(); let calls = 0;
  const observed = await fetchHellfestOfferObservation({ fetchImpl: async (target, options) => {
    calls++; assert.equal(target, url); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(Object.keys(options.headers), ['accept']); assert.ok(options.signal);
    return response();
  } });
  assert.equal(calls, 1); assert.equal(observed.html, '<html>test</html>');
  assert.equal(observed.finalUrl, url); assert.equal(observed.status, 200);
  assert.ok(Date.parse(observed.observedAt) >= before && Date.parse(observed.observedAt) <= Date.now());
});
for (const options of [ { status: 403 }, { status: 429 }, { status: 500 }, { status: 206 }, { status: 302 },
  { url: 'https://foreign.invalid/' }, { url: '' }, { redirected: true },
  { headers: { 'content-type': 'application/json' } }, { headers: { 'content-type': 'text/html-bogus' } },
  { headers: { 'content-length': '2000001' } }, { headers: { 'content-length': 'bogus' } },
]) test(`reject transport mismatch ${JSON.stringify(options)}`, async () => {
  let calls = 0;
  await assert.rejects(fetchHellfestOfferObservation({ fetchImpl: async () => { calls++; return response('x', options); } }));
  assert.equal(calls, 1, 'no retries or alternate sources');
});
test('empty, invalid UTF8, streamed oversize and stream failures are errors', async () => {
  for (const body of ['', new Uint8Array([0xff]), 'x'.repeat(2_000_001), new ReadableStream({ start(c) { c.error(new Error('broken stream')); } })]) {
    await assert.rejects(fetchHellfestOfferObservation({ fetchImpl: async () => response(body) }));
  }
});
test('deadline bounds headers and streaming body even with non-cooperating fetch/stream', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }))]) {
    const before = Date.now();
    await assert.rejects(fetchHellfestOfferObservation({ fetchImpl, timeoutMs: 10 }), /deadline/);
    assert.ok(Date.now() - before < 1000);
  }
});
test('network errors are not healthy empty results; deadline cannot be disabled', async () => {
  await assert.rejects(fetchHellfestOfferObservation({ fetchImpl: async () => { throw new Error('network failure'); } }), /network/);
  for (const timeoutMs of [0, -1, Infinity, 20_001, 1.5]) await assert.rejects(fetchHellfestOfferObservation({ timeoutMs }));
});
