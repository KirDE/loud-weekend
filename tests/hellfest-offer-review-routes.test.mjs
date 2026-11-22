import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectUntrustedOrigin } from '../lib/request-origin.ts';
import { loadReviewRoute } from './support/hellfest-review-routes.mjs';
const hash = 'a'.repeat(64);
const ctx = { params: Promise.resolve({ id: 'synthetic-snapshot' }) };
const payload = { decision: 'approve', expectedContentHash: hash };
function request(body = payload, headers = {}) {
  return new Request('https://tier.example.invalid/api/admin/ticket-offers/snapshots/synthetic-snapshot', {
    method: 'POST', headers: { origin: 'https://tier.example.invalid', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function harness(actor = { id: 'session-actor' }, service = {}) {
  const calls = [];
  const deps = {
    '@/lib/admin-access': { currentAdmin: async () => { calls.push('auth'); return actor; } },
    '@/lib/db': { db: {} },
    '@/lib/request-origin': { rejectUntrustedOrigin },
    '@/lib/ingestion/ticket-offer-proposal-store': {
      decideHellfestOffers: async (_db, input) => { calls.push(input); return { ...input, actorId: 'private-actor', internal: 'private' }; },
      readPendingHellfestOffers: async () => { calls.push('read'); return { id: 'snapshot', contentHash: hash, reviewState: 'pending' }; },
      ...service,
    },
  };
  return { post: (await loadReviewRoute('snapshots', deps)).POST, get: (await loadReviewRoute('editions', deps)).GET, calls };
}
test('actual review POST rejects foreign, missing and opaque origins before authentication/body/DB', async () => {
  const old = process.env.APP_URL; process.env.APP_URL = 'https://tier.example.invalid';
  try {
    for (const origin of ['https://foreign.invalid', '', 'null', 'https://tier.example.invalid/path']) {
      const h = await harness(); const res = await h.post(request(payload, { origin }), ctx);
      assert.equal(res.status, 403); assert.deepEqual(h.calls, []);
    }
  } finally { if (old === undefined) delete process.env.APP_URL; else process.env.APP_URL = old; }
});
test('actual routes deny absent reviewer without reading proposals or deciding', async () => {
  const h = await harness(null);
  assert.equal((await h.post(request(), ctx)).status, 403);
  assert.equal((await h.get(new Request('https://tier.example.invalid'), ctx)).status, 403);
  assert.deepEqual(h.calls, ['auth', 'auth']);
});
test('actual review route rejects malformed, extra actor, invalid decision/hash and oversized stream', async () => {
  for (const body of ['{', 'null', [], { ...payload, actorId: 'forged' }, { ...payload, offers: [] }, { ...payload, decision: 'publish' }, { ...payload, expectedContentHash: 'bad' }, ' '.repeat(4097)]) {
    const h = await harness(); const res = await h.post(request(body), ctx);
    assert.equal(res.status, typeof body === 'string' && body.length > 4096 ? 413 : 400);
    assert.deepEqual(h.calls, ['auth']);
  }
  const h = await harness();
  assert.equal((await h.post(request(payload, { 'content-type': 'text/plain' }), ctx)).status, 400);
});
test('actual review route binds path/hash and session actor; returns only minimal no-store result', async () => {
  const h = await harness();
  const res = await h.post(request(), ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(h.calls[1], { ...payload, snapshotId: 'synthetic-snapshot', actorId: 'session-actor' });
  assert.deepEqual(await res.json(), { snapshotId: 'synthetic-snapshot', decision: 'approve' });
});
test('actual routes hide DB diagnostics and return conflicts rather than false success', async () => {
  const fail = async () => { throw new Error('private database diagnostic'); };
  const h = await harness(undefined, { decideHellfestOffers: fail, readPendingHellfestOffers: fail });
  for (const res of [await h.post(request(), ctx), await h.get(new Request('https://tier.example.invalid'), ctx)]) {
    assert.equal(res.status, 409); assert.doesNotMatch(await res.text(), /private database/);
  }
});
test('actual reviewer GET supplies exact review revision and no-store; absent proposal is 404', async () => {
  const h = await harness(); const req = new Request('https://tier.example.invalid');
  const res = await h.get(req, ctx);
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await res.json(), { id: 'snapshot', contentHash: hash, reviewState: 'pending' });
  const empty = await harness(undefined, { readPendingHellfestOffers: async () => null });
  assert.equal((await empty.get(req, ctx)).status, 404);
});
test('actual decision body rejects invalid UTF8/stream errors and a lying Content-Length', async () => {
  for (const stream of [
    new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff, 0xfe])); c.close(); } }),
    new ReadableStream({ start(c) { c.error(new Error('synthetic disconnect')); } }),
    new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); c.close(); } }),
  ]) {
    const h = await harness();
    const req = new Request('https://tier.example.invalid/review', { method: 'POST', duplex: 'half', headers: { origin: 'https://tier.example.invalid', 'content-type': 'application/json', 'content-length': '1' }, body: stream });
    const res = await h.post(req, ctx);
    assert.ok([400, 413].includes(res.status)); assert.deepEqual(h.calls, ['auth']);
  }
});
test('actual decision body deadline bounds a stalled stream without calling the store', async () => {
  const h = await harness(); let cancelled = false;
  const req = new Request('https://tier.example.invalid/review', { method: 'POST', duplex: 'half', headers: { origin: 'https://tier.example.invalid', 'content-type': 'application/json' }, body: new ReadableStream({ cancel() { cancelled = true; } }) });
  const res = await h.post(req, ctx);
  assert.equal(res.status, 400); assert.equal(cancelled, true); assert.deepEqual(h.calls, ['auth']);
});
