import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrismaClient } from '../lib/prisma-client.mjs';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { collectPendingHellfestOffers } from '../lib/ingestion/hellfest-offer-collector.ts';
import { stageHellfestOffers, readPendingHellfestOffers } from '../lib/ingestion/ticket-offer-proposal-store.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const html = readFileSync(new URL('./fixtures/hellfest/offer-cards.html', import.meta.url), 'utf8');
const slug = 'hellfest';
let editionId: string;
const time = Date.now() - 10_000;
const input = (delta = 0) => ({ editionId, html, finalUrl: 'https://hellfest.fr/', status: 200, observedAt: new Date(time + delta).toISOString() });
test.before(async () => {
  // Refuse to overwrite fixtures/data owned by another test suite.
  assert.equal(await db.festival.count({ where: { slug } }), 0, 'Requires isolated disposable DB without Hellfest');
  const f = await db.festival.create({ data: { slug, name: 'Synthetic Hellfest', country: 'France', countryCode: 'FR', officialUrl: 'https://hellfest.fr/', genres: [] } });
  const e = await db.festivalEdition.create({ data: { festivalId: f.id, year: 2027, status: 'CONFIRMED', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'COMPLETE', sourceUpdatedAt: new Date(time) } });
  editionId = e.id;
});
test.after(async () => {
  if (editionId) await db.festival.deleteMany({ where: { slug, editions: { some: { id: editionId } } } });
  await db.$disconnect();
});
test('durable tier staging, pending readback, replay; no global/publication/provider mutation', async () => {
  const before = await db.festivalEdition.findUnique({ where: { id: editionId } });
  const pubs = await db.catalogPublication.count();
  const jobs = await db.catalogPlaylistRefresh.count();
  const notifications = await db.ingestionNotificationOutbox.count();
  const sources = await db.ingestionSourceState.count();
  const row = await stageHellfestOffers(db, input());
  const pending = await readPendingHellfestOffers(db, editionId);
  assert.equal(pending!.reviewState, 'pending');
  assert.deepEqual(pending!.proposal.offers.map(o => o.status), ['sold_out', 'not_on_sale']);
  assert.equal(pending!.proposal.offers[0].price!.amountMinor, 38900);
  assert.equal(pending!.proposal.offers[1].price, null);
  assert.equal((await stageHellfestOffers(db, input())).id, row.id);
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 1);
  assert.deepEqual(await db.festivalEdition.findUnique({ where: { id: editionId } }), before);
  assert.equal(await db.catalogPublication.count(), pubs);
  assert.equal(await db.catalogPlaylistRefresh.count(), jobs);
  assert.equal(await db.ingestionNotificationOutbox.count(), notifications);
  assert.equal(await db.ingestionSourceState.count(), sources);
});
test('rejects bad transport, mismatched edition, stale/future/ambiguous observations atomically', async () => {
  for (const change of [ { status: 403 }, { finalUrl: 'https://other.invalid/' }, { html: html.replaceAll('2027', '2026') },
    { observedAt: new Date(time - 86_400_000).toISOString() }, { observedAt: new Date(Date.now() + 120_000).toISOString() },
    { html: html.replace('389€', 'wrong') }, { editionId: 'missing' }, { observedAt: new Date(time - 1).toISOString() },
    { html: html.replace('389€', '400€') },
  ]) await assert.rejects(stageHellfestOffers(db, { ...input(), ...change }));
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 1);
  assert.equal((await readPendingHellfestOffers(db, editionId))!.proposal.offers[0].price!.amountMinor, 38900);
});
test('concurrent replay serialized; newer observations append without rewriting history', async () => {
  const rows = await Promise.all([stageHellfestOffers(db, input(1)), stageHellfestOffers(db, input(1))]);
  assert.equal(rows[0].id, rows[1].id);
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 2);
  await stageHellfestOffers(db, { ...input(2), html: html.replace('389€', '399€') });
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 3);
  assert.equal((await readPendingHellfestOffers(db, editionId))!.proposal.offers[0].price!.amountMinor, 39900);
});
test('readback rejects stored value/time/source/hash drift instead of falling back', async () => {
  const row = await db.ticketOfferProposalSnapshot.findFirstOrThrow({ orderBy: { observedAt: 'desc' } });
  for (const patch of [{ sourceUrl: 'https://other.invalid/' }, { contentHash: '0'.repeat(64) }, { parserVersion: 'other' },
    { proposal: { ...(row.proposal as object), ticketStatus: 'available' } }, { observedAt: new Date(time + 50) }]) {
    await db.ticketOfferProposalSnapshot.update({ where: { id: row.id }, data: patch });
    await assert.rejects(readPendingHellfestOffers(db, editionId));
    await assert.rejects(stageHellfestOffers(db, input(100)));
    await db.ticketOfferProposalSnapshot.update({ where: { id: row.id }, data: { sourceUrl: row.sourceUrl, contentHash: row.contentHash, parserVersion: row.parserVersion, proposal: row.proposal!, observedAt: row.observedAt } });
  }
  await db.festivalEdition.update({ where: { id: editionId }, data: { year: 2028 } });
  await assert.rejects(readPendingHellfestOffers(db, editionId));
  await assert.rejects(stageHellfestOffers(db, input(3)));
  await db.festivalEdition.update({ where: { id: editionId }, data: { year: 2027 } });
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 3);
});

test('rejects slug, canonical source and current-edition target drift', async () => {
  const e = await db.festivalEdition.findUniqueOrThrow({ where: { id: editionId } });
  for (const patch of [{ slug: 'foreign-hellfest' }, { officialUrl: 'https://foreign.invalid/' }]) {
    await db.festival.update({ where: { id: e.festivalId }, data: patch });
    await assert.rejects(stageHellfestOffers(db, input(100)));
    await assert.rejects(readPendingHellfestOffers(db, editionId));
    await db.festival.update({ where: { id: e.festivalId }, data: { slug, officialUrl: 'https://hellfest.fr/' } });
  }
  await db.festivalEdition.update({ where: { id: editionId }, data: { recordState: 'ARCHIVED' } });
  await assert.rejects(stageHellfestOffers(db, input(100)));
  await assert.rejects(readPendingHellfestOffers(db, editionId));
  await db.festivalEdition.update({ where: { id: editionId }, data: { recordState: 'CURRENT' } });
  assert.equal(await db.ticketOfferProposalSnapshot.count(), 3);
});


test('strict GET collector to durable pending evidence; failures preserve last-good snapshot', async () => {
  const before = await db.festivalEdition.findUnique({ where: { id: editionId } });
  const count = await db.ticketOfferProposalSnapshot.count();
  const makeResponse = (body: string, status = 200) => {
    const r = new Response(body, { status, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(r, 'url', { value: 'https://hellfest.fr/' });
    return r;
  };
  for (const fetchImpl of [
    async () => makeResponse('blocked', 403),
    async () => makeResponse(html.replaceAll('2027', '2026')),
    async () => makeResponse(html.replace('389€', 'wrong')),
    async () => makeResponse('<html>Challenge</html>'),
    async () => { throw new Error('network'); },
  ]) {
    await assert.rejects(collectPendingHellfestOffers(db, editionId, { fetchImpl }));
    assert.equal(await db.ticketOfferProposalSnapshot.count(), count);
    assert.equal((await readPendingHellfestOffers(db, editionId))!.proposal.offers[0].price!.amountMinor, 39900);
  }
  const row = await collectPendingHellfestOffers(db, editionId, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://hellfest.fr/'); assert.equal(options?.method, 'GET');
    return makeResponse(html);
  } });
  const pending = await readPendingHellfestOffers(db, editionId);
  assert.equal(pending!.id, row.id); assert.equal(pending!.reviewState, 'pending');
  assert.deepEqual(pending!.proposal.offers.map(o => o.status), ['sold_out', 'not_on_sale']);
  assert.equal(await db.ticketOfferProposalSnapshot.count(), count + 1);
  assert.deepEqual(await db.festivalEdition.findUnique({ where: { id: editionId } }), before);
});

test('explicit review: authorization, exact revision, atomic audit, concurrent replay and approved readback', async () => {
  const { decideHellfestOffers, readApprovedHellfestOffers } = await import('../lib/ingestion/ticket-offer-proposal-store.ts');
  const oldAllowlist = process.env.ADMIN_EMAILS;
  const actor = await db.user.create({ data: { email: `synthetic-tier-${randomUUID()}@example.invalid`, role: 'USER' } });
  const before = await db.festivalEdition.findUnique({ where: { id: editionId } });
  const counts = await Promise.all([db.catalogPublication.count(), db.catalogPlaylistRefresh.count(), db.ingestionNotificationOutbox.count(), db.ingestionSourceState.count()]);
  try {
    const row = await db.ticketOfferProposalSnapshot.findFirstOrThrow({ where: { editionId }, orderBy: { observedAt: 'desc' } });
    const review = { snapshotId: row.id, expectedContentHash: row.contentHash, decision: 'approve' as const, actorId: actor.id };
    assert.equal(await readApprovedHellfestOffers(db, editionId), null, 'pending is never public');
    process.env.ADMIN_EMAILS = actor.email;
    await assert.rejects(decideHellfestOffers(db, review), /Authorized/);
    await db.user.update({ where: { id: actor.id }, data: { role: 'EDITOR' } });
    process.env.ADMIN_EMAILS = '';
    await assert.rejects(decideHellfestOffers(db, review), /Authorized/);
    process.env.ADMIN_EMAILS = actor.email;
    await assert.rejects(decideHellfestOffers(db, { ...review, actorId: 'missing' }), /Authorized/);
    await assert.rejects(decideHellfestOffers(db, { ...review, expectedContentHash: '0'.repeat(64) }), /revision/);
    const old = await db.ticketOfferProposalSnapshot.findFirstOrThrow({ where: { editionId }, orderBy: { observedAt: 'asc' } });
    await assert.rejects(decideHellfestOffers(db, { ...review, snapshotId: old.id, expectedContentHash: old.contentHash }), /Superseded/);
    assert.equal(await db.ticketOfferReviewDecision.count(), 0);
    assert.equal(await db.adminAuditEntry.count({ where: { actorId: actor.id } }), 0);
    // A real transaction with an injected audit failure must roll back the decision.
    const failAuditDb = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (fn: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
        const wrapped = new Proxy(tx, { get(inner, name) {
          if (name === 'adminAuditEntry') return { create: async () => { throw new Error('injected audit failure'); } };
          return Reflect.get(inner, name);
        } });
        return (fn as (value: typeof tx) => Promise<unknown>)(wrapped);
      });
      return Reflect.get(target, key);
    } });
    await assert.rejects(decideHellfestOffers(failAuditDb, review), /injected audit failure/);
    assert.equal(await db.ticketOfferReviewDecision.count(), 0);
    assert.equal(await readApprovedHellfestOffers(db, editionId), null);
    const [first, second] = await Promise.all([decideHellfestOffers(db, review), decideHellfestOffers(db, review)]);
    assert.equal(first.id, second.id);
    assert.equal(await db.adminAuditEntry.count({ where: { actorId: actor.id } }), 1);
    assert.equal((await readPendingHellfestOffers(db, editionId))!.reviewState, 'approved');
    assert.equal((await readApprovedHellfestOffers(db, editionId))!.id, row.id);
    await assert.rejects(decideHellfestOffers(db, { ...review, decision: 'reject' }), /already decided/);
    // Newer pending and rejected proposals must not replace explicit approval.
    const newer = await stageHellfestOffers(db, { ...input(), observedAt: new Date(Math.max(Date.now(), row.observedAt.getTime() + 1)).toISOString(), html: html.replace('389€', '409€') });
    assert.equal((await readPendingHellfestOffers(db, editionId))!.reviewState, 'pending');
    assert.equal((await readApprovedHellfestOffers(db, editionId))!.id, row.id);
    const reject = { ...review, snapshotId: newer.id, expectedContentHash: newer.contentHash, decision: 'reject' as const };
    await decideHellfestOffers(db, reject);
    assert.equal((await readPendingHellfestOffers(db, editionId))!.reviewState, 'rejected');
    assert.equal((await readApprovedHellfestOffers(db, editionId))!.id, row.id);
    assert.equal(await db.adminAuditEntry.count({ where: { actorId: actor.id } }), 2);
    // Mutated approval proof must fail, never fall back to another snapshot.
    await db.ticketOfferReviewDecision.update({ where: { id: first.id }, data: { contentHash: '0'.repeat(64) } });
    await assert.rejects(readApprovedHellfestOffers(db, editionId), /decision proof/);
    await db.ticketOfferReviewDecision.update({ where: { id: first.id }, data: { contentHash: row.contentHash } });
    await db.ticketOfferProposalSnapshot.update({ where: { id: row.id }, data: { parserVersion: 'foreign' } });
    await assert.rejects(readApprovedHellfestOffers(db, editionId), /proof mismatch/);
    await db.ticketOfferProposalSnapshot.update({ where: { id: row.id }, data: { parserVersion: row.parserVersion } });
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 86_400_001;
      assert.equal(await readApprovedHellfestOffers(db, editionId), null, 'expired approval is not current inventory');
    } finally { Date.now = realNow; }
    // Target drift invalidates even an approved snapshot.
    await db.festivalEdition.update({ where: { id: editionId }, data: { year: 2028 } });
    await assert.rejects(readApprovedHellfestOffers(db, editionId), /proof mismatch/);
    await db.festivalEdition.update({ where: { id: editionId }, data: { year: 2027, updatedAt: before!.updatedAt } });
    assert.deepEqual(await db.festivalEdition.findUnique({ where: { id: editionId } }), before);
    assert.deepEqual(await Promise.all([db.catalogPublication.count(), db.catalogPlaylistRefresh.count(), db.ingestionNotificationOutbox.count(), db.ingestionSourceState.count()]), counts);
  } finally {
    if (oldAllowlist === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = oldAllowlist;
    // Keep append-only audit and its synthetic actor in this disposable DB.
    // The fixture edition cleanup cascades its proposal/decision history only.
  }
});
