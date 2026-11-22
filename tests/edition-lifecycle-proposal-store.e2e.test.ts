import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrismaClient } from '../lib/prisma-client.mjs';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { stageRockEnSeineHiatus as stage, readPendingRockEnSeineHiatus as read } from '../lib/ingestion/edition-lifecycle-proposal-store.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const html = readFileSync(new URL('./fixtures/rock-en-seine/hiatus.html', import.meta.url), 'utf8');
const url = 'https://www.rockenseine.com/';
const slug = 'rock-en-seine';
let editionId: string;
let festivalId: string;
const time = Date.now() - 10_000;
const input = (delta = 0) => ({ editionId, html, requestedUrl: url, finalUrl: url, status: 200, observedAt: new Date(time + delta).toISOString() });
test.before(async () => {
  assert.equal(await db.festival.count({ where: { slug } }), 0, 'Requires isolated disposable DB without Rock en Seine');
  const f = await db.festival.create({ data: { slug, name: 'Synthetic Rock en Seine', country: 'France', countryCode: 'FR', officialUrl: url, genres: [] } });
  festivalId = f.id;
  editionId = (await db.festivalEdition.create({ data: { festivalId, year: 2027, status: 'CONFIRMED', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'COMPLETE', sourceUpdatedAt: new Date(time), startDate: new Date('2027-08-25'), endDate: new Date('2027-08-29') } })).id;
});
test.after(async () => {
  if (festivalId) await db.festival.deleteMany({ where: { id: festivalId } });
  await db.$disconnect();
});
test('absent lifecycle evidence is not a confirmed active edition', async () => assert.equal(await read(db, editionId), null));
test('durable pending evidence/read/replay has NO catalogue, health, provider or notification effects', async () => {
  const before = await db.festivalEdition.findMany();
  const counts = async () => Promise.all([db.catalogPublication.count(), db.catalogPlaylistRefresh.count(), db.ingestionNotificationOutbox.count(), db.ingestionSourceState.count()]);
  const priorCounts = await counts();
  const row = await stage(db, input());
  const pending = await read(db, editionId);
  assert.equal(pending!.id, row.id); assert.equal(pending!.reviewState, 'pending'); assert.equal(pending!.eligibleForReview, true);
  assert.equal(pending!.proposal.lifecycle, 'hiatus'); assert.equal(pending!.proposal.announcedReturnYear, 2028);
  assert.equal(pending!.proposal.alternativeEvent, 'under_consideration');
  assert.equal((await stage(db, input())).id, row.id);
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 1);
  assert.deepEqual(await db.festivalEdition.findMany(), before); // also no 2028 auto-creation
  assert.deepEqual(await counts(), priorCounts);
  assert.doesNotMatch(JSON.stringify(row.proposal), /<html|ticketStatus|startDate|endDate|cookies|session/);
});
test('bad transport/notice/clock/target rejected without partial stage', async () => {
  for (const change of [{ status: 403 }, { status: 206 }, { requestedUrl: url + '?x=1' }, { finalUrl: 'https://other.invalid/' },
    { html: html.replaceAll('2027', '2026') }, { html: html.replace('une pause', 'un festival') }, { html: '' },
    { observedAt: new Date(time - 86_400_001).toISOString() }, { observedAt: new Date(Date.now() + 120_000).toISOString() },
    { observedAt: new Date(time - 1).toISOString() }, { editionId: 'absent' }]) await assert.rejects(stage(db, { ...input(), ...change }));
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 1);
});
test('concurrent first/newer replay is serialized, historical snapshots retained', async () => {
  // Independent empty history for the same reviewed identity, after retaining first row locally.
  const first = await db.editionLifecycleProposalSnapshot.findFirstOrThrow();
  await db.editionLifecycleProposalSnapshot.delete({ where: { id: first.id } });
  const rows = await Promise.all([stage(db, input()), stage(db, input())]);
  assert.equal(rows[0].id, rows[1].id);
  const newer = await Promise.all([stage(db, input(1)), stage(db, input(1))]);
  assert.equal(newer[0].id, newer[1].id);
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 2);
  assert.equal((await read(db, editionId))!.id, newer[0].id);
});
test('persisted evidence drift fails read AND new staging without older healthy fallback', async () => {
  const row = await db.editionLifecycleProposalSnapshot.findFirstOrThrow({ orderBy: { observedAt: 'desc' } });
  for (const patch of [{ sourceUrl: 'https://other.invalid/' }, { finalUrl: url + 'archive/' }, { httpStatus: 403 },
    { contentHash: '0'.repeat(64) }, { parserVersion: 'unknown' }, { observedAt: new Date(time + 2) },
    { proposal: { ...(row.proposal as object), ticketStatus: 'available' } },
    { proposal: { ...(row.proposal as object), lifecycle: 'active' } },
    { proposal: { ...(row.proposal as object), announcedReturnYear: 2029 } },
    { proposal: { ...(row.proposal as object), excerpt: 'forged assertion' } }]) {
    await db.editionLifecycleProposalSnapshot.update({ where: { id: row.id }, data: patch });
    await assert.rejects(read(db, editionId)); await assert.rejects(stage(db, input(100)));
    await db.editionLifecycleProposalSnapshot.update({ where: { id: row.id }, data: {
      sourceUrl: row.sourceUrl, finalUrl: row.finalUrl, httpStatus: row.httpStatus, contentHash: row.contentHash,
      parserVersion: row.parserVersion, observedAt: row.observedAt, proposal: row.proposal!,
    } });
  }
  assert.equal(await db.editionLifecycleProposalSnapshot.count(), 2);
});
test('source and edition rebinding cannot authorize evidence', async () => {
  for (const patch of [{ slug: 'other' }, { officialUrl: 'https://other.invalid/' }]) {
    await db.festival.update({ where: { id: festivalId }, data: patch });
    await assert.rejects(read(db, editionId)); await assert.rejects(stage(db, input(100)));
    await db.festival.update({ where: { id: festivalId }, data: { slug, officialUrl: url } });
  }
  for (const patch of [{ year: 2028 }, { recordState: 'ARCHIVED' as const }]) {
    await db.festivalEdition.update({ where: { id: editionId }, data: patch });
    await assert.rejects(read(db, editionId)); await assert.rejects(stage(db, input(100)));
    await db.festivalEdition.update({ where: { id: editionId }, data: { year: 2027, recordState: 'CURRENT' } });
  }
});
test('valid but expired evidence stays historical pending, NOT eligible for review', async () => {
  const now = Date.now;
  try {
    Date.now = () => time + 86_400_003;
    const pending = await read(db, editionId);
    assert.equal(pending!.reviewState, 'pending'); assert.equal(pending!.eligibleForReview, false);
    await assert.rejects(stage(db, input(2)));
  } finally { Date.now = now; }
});
