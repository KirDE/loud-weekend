import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { lifecycleProposalSchema, publicEditionLifecycleSchema } from '../lib/domain/edition-lifecycle-review.ts';
import { editionOnHiatus } from '../lib/edition-lifecycle.ts';
import { ticketPresentation } from '../lib/tickets.ts';
import { calendarFile } from '../lib/planning.ts';
import { EditionLifecycleNotice } from '../components/EditionLifecycleNotice.tsx';
import { LanguageProvider } from '../components/LanguageProvider.tsx';
import { lifecycleSource } from '../lib/ingestion/lifecycle-sources.ts';
import { festival } from './support/catalog.ts';

const notice = {
  festivalSlug: 'different-festival', editionYear: 2031, lifecycle: 'hiatus',
  announcedReturnYear: null, alternativeEvent: null, sourceUrl: 'https://different.example.test/',
  observedAt: '2030-11-22T18:00:00.000Z', approvedAt: '2030-11-22T19:00:00.000Z',
};
test('generic domain/UI/calendar/tickets handle another festival/year without a return announcement', () => {
  const item = { ...festival, slug: notice.festivalSlug, editionYear: notice.editionYear,
    officialUrl: notice.sourceUrl, editionLifecycle: publicEditionLifecycleSchema.parse(notice) };
  const { approvedAt: _approvedAt, ...proposal } = notice;
  lifecycleProposalSchema.parse({ ...proposal, excerpt: 'A minimized source-backed pause assertion.' });
  assert.equal(editionOnHiatus(item), true);
  assert.equal(ticketPresentation(item).status, 'hiatus');
  assert.doesNotMatch(calendarFile([item]), /BEGIN:VEVENT/);
  for (const locale of ['en', 'de', 'ru']) {
    const html = renderToStaticMarkup(h(LanguageProvider, { initialLanguage: locale }, h(EditionLifecycleNotice, { item })));
    assert.match(html, /2031/);
    assert.doesNotMatch(html, /2027|2028|Rock en Seine|under consideration/);
    assert.match(html, /https:\/\/different.example.test\//);
  }
  assert.throws(() => editionOnHiatus({ ...item, slug: 'transferred' }));
  assert.throws(() => editionOnHiatus({ ...item, editionYear: 2032 }));
  assert.throws(() => editionOnHiatus({ ...item, officialUrl: 'https://foreign.example.test/' }));
});
test('generic validation is not authority to introduce an unreviewed source or modify a trusted proof', () => {
  assert.throws(() => lifecycleSource('different-unreviewed-parser'));
  const source = lifecycleSource('rock-en-seine-hiatus-v1');
  assert.throws(() => source.validate({ ...notice, excerpt: 'Forged' }));
});
test('shared layers contain no festival-specific names, URLs, parser or years', async () => {
  for (const file of ['app/admin/page.tsx', 'lib/domain/edition-lifecycle-review.ts',
    'lib/edition-lifecycle.ts', 'lib/ingestion/edition-lifecycle-proposal-store.ts',
    'lib/catalog/repository.ts', 'components/LifecycleReviewQueue.tsx', 'components/EditionLifecycleNotice.tsx']) {
    const code = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /rock.?en.?seine|rockenseine|2027|2028/i, file);
  }
  const offline = await readFile(new URL('../lib/catalog/offline.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(offline, /rock.?en.?seine|rockenseine/i);
});
