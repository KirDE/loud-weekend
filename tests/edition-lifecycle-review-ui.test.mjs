import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { observeRockEnSeineHiatus, ROCK_EN_SEINE_HOME } from '../lib/ingestion/adapters/rock-en-seine-hiatus.ts';
import { loadLifecycleReview, submitLifecycleReview } from '../lib/edition-lifecycle-review-client.ts';
const require = createRequire(import.meta.url);
const fixture = await readFile(new URL('./fixtures/rock-en-seine/hiatus.html', import.meta.url), 'utf8');
function snapshot() {
  const proposal = observeRockEnSeineHiatus(fixture, new Date().toISOString(), { status: 200, finalUrl: ROCK_EN_SEINE_HOME });
  assert.ok(proposal);
  return { id: 'snapshot/test', contentHash: 'a'.repeat(64), reviewState: 'pending', eligibleForReview: true, proposal };
}
function reply(body, status = 200) { return Response.json(body, { status }); }
const source = await readFile(new URL('../components/LifecycleReviewQueue.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022' });
function harness(fetcher, locale = 'en') {
  const slots = []; let cursor = 0;
  const deps = {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; }, useEffect() {},
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../lib/edition-lifecycle-review-client': { loadLifecycleReview: (id, signal) => loadLifecycleReview(id, signal, fetcher), submitLifecycleReview: (s, d, signal) => submitLifecycleReview(s, d, signal, fetcher) },
  };
  const module = { exports: {} };
  new Function('require','module','exports', code)(id => { assert.ok(Object.hasOwn(deps, id), id); return deps[id]; }, module, module.exports);
  const render = () => { cursor = 0; return module.exports.LifecycleReviewQueue({ editionId: 'edition/test', year: 2027, festivalSlug: 'rock-en-seine', sourceUrl: ROCK_EN_SEINE_HOME, locale }); };
  const buttons = tree => {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(buttons);
    return [...(tree.type === 'button' ? [tree] : []), ...buttons(tree.props?.children)];
  };
  return { render, buttons };
}
for (const locale of ['en','de','ru']) test(`actual queue loads revision/evidence, then approves and rereads in ${locale}`, async () => {
  const value = snapshot(); const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') { value.reviewState = 'approved'; value.eligibleForReview = false; return reply({ snapshotId: value.id, decision: 'approve' }); }
    return reply(value);
  }, locale);
  await h.buttons(h.render())[0].props.onClick();
  const loaded = h.render(); const html = renderToStaticMarkup(loaded);
  assert.match(html, /2027/); assert.match(html, /2028/); assert.match(html, /rockenseine.com/); assert.match(html, /aaaaaaaa/);
  assert.equal(h.buttons(loaded).length, 3);
  await h.buttons(loaded)[2].props.onClick();
  assert.equal(h.buttons(h.render()).length, 1);
  assert.deepEqual(JSON.parse(calls[1].options.body), { decision: 'approve', expectedContentHash: value.contentHash });
  assert.match(calls[0].url, /edition%2Ftest$/); assert.match(calls[1].url, /snapshot%2Ftest$/);
  assert.equal(calls.length, 3); assert.equal(calls[0].options.cache, 'no-store');
});
test('actual queue clears stale actions on conflict, malformed data, denied reviewer or unconfirmed decision', async () => {
  for (const failure of [reply({ error: 'Conflict' }, 409), reply({ error: 'Forbidden' }, 403), reply({ snapshotId: 'other', decision: 'approve' }), new Response('<html>challenge</html>')]) {
    const value = snapshot(); let count = 0;
    const h = harness(async () => ++count === 1 ? reply(value) : failure);
    await h.buttons(h.render())[0].props.onClick();
    await h.buttons(h.render())[2].props.onClick();
    assert.equal(h.buttons(h.render()).length, 1);
    assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /aaaaaaaa/);
  }
});
test('actual queue rejects foreign edition, corrupt schema and expired proposals for decisions', async () => {
  for (const change of [s => { s.proposal.editionYear = 2026; }, s => { s.contentHash = 'bad'; }, s => { s.proposal.sourceUrl = 'https://foreign.invalid/'; }]) {
    const value = snapshot(); change(value); const h = harness(async () => reply(value));
    await h.buttons(h.render())[0].props.onClick(); assert.equal(h.buttons(h.render()).length, 1);
    assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
  }
  const value = snapshot(); value.proposal.observedAt = new Date(Date.now() - 86_500_000).toISOString();
  const h = harness(async () => reply(value)); await h.buttons(h.render())[0].props.onClick();
  assert.ok(h.buttons(h.render()).slice(1).every(b => b.props.disabled));
});
test('missing proposal is distinct from failed response, and duplicate in-flight clicks do not double decide', async () => {
  const empty = harness(async () => reply({ error: 'No lifecycle proposal' }, 404));
  await empty.buttons(empty.render())[0].props.onClick(); assert.match(renderToStaticMarkup(empty.render()), /No proposal collected/);
  let resolve; let calls = 0;
  const h = harness(async () => { calls++; return new Promise(r => { resolve = r; }); });
  const button = h.buttons(h.render())[0]; const first = button.props.onClick(); await button.props.onClick();
  assert.equal(calls, 1); resolve(reply(snapshot())); await first;
});

test('server ineligibility cannot be overridden by fresh client time; non-pending states cannot offer actions', async () => {
  for (const state of ['pending', 'approved', 'rejected']) {
    const value = snapshot(); value.eligibleForReview = false; value.reviewState = state;
    const h = harness(async () => reply(value)); await h.buttons(h.render())[0].props.onClick();
    if (state === 'pending') assert.ok(h.buttons(h.render()).slice(1).every(b => b.props.disabled));
    else assert.equal(h.buttons(h.render()).length, 1);
    await assert.rejects(submitLifecycleReview(value, 'approve', new AbortController().signal, () => assert.fail('must not submit')));
  }
});
test('revision that expires after rendering cannot be submitted, uncertain success reread clears actions', async () => {
  const value = snapshot(); let calls = 0;
  const h = harness(async (_url, options) => {
    calls++;
    if (calls === 1) return reply(value);
    if (options.method === 'POST') return reply({ snapshotId: value.id, decision: 'approve' });
    return reply({ error: 'Forbidden' }, 403);
  });
  await h.buttons(h.render())[0].props.onClick(); await h.buttons(h.render())[2].props.onClick();
  assert.equal(h.buttons(h.render()).length, 1); assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
  value.proposal.observedAt = new Date(Date.now() - 86_500_000).toISOString();
  await assert.rejects(submitLifecycleReview(value, 'approve', new AbortController().signal, () => assert.fail('expired must not submit')));
});
test('schema rejects incompatible lifecycle assertions and missing eligibility, no unavailable-to-empty fallback', async () => {
  for (const change of [v => { delete v.eligibleForReview; }, v => { v.proposal.lifecycle = 'sold_out'; }, v => { v.proposal.announcedReturnYear = 2027; }, v => { v.reviewState = 'approved'; }]) {
    const value = snapshot(); change(value); const h = harness(async () => reply(value));
    await h.buttons(h.render())[0].props.onClick(); assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
    assert.equal(h.buttons(h.render()).length, 1);
  }
  await assert.rejects(loadLifecycleReview('edition/test', new AbortController().signal, async () => reply({ error: 'Not authorized' }, 404)));
});

test('reject uses exact revision and rereads; two same-frame decisions submit once', async () => {
  const value = snapshot(); let release; let posts = 0;
  const h = harness(async (_url, options) => {
    if (options.method === 'POST') {
      posts++; assert.deepEqual(JSON.parse(options.body), { decision: 'reject', expectedContentHash: value.contentHash });
      await new Promise(r => { release = r; });
      value.reviewState = 'rejected'; value.eligibleForReview = false;
      return reply({ snapshotId: value.id, decision: 'reject' });
    }
    return reply(value);
  });
  await h.buttons(h.render())[0].props.onClick();
  const reject = h.buttons(h.render())[1]; const first = reject.props.onClick(); await reject.props.onClick();
  assert.equal(posts, 1); release(); await first;
  assert.equal(h.buttons(h.render()).length, 1); assert.match(renderToStaticMarkup(h.render()), /Rejected/);
});

test('admin review section actually mounts canonical server-provided lifecycle targets', async () => {
  const source = await readFile(new URL('../components/AdminConsole.tsx', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022' });
  const module = { exports: {} };
  const deps = {
    react: { useState: v => [v, () => {}], useEffect() {}, useMemo: fn => fn() },
    'react/jsx-runtime': require('react/jsx-runtime'),
    './LanguageProvider': { useLanguage: () => ({ language: 'ru', setLanguage() {}, ta: v => v }) },
    './LifecycleReviewQueue': { LifecycleReviewQueue: props => require('react').createElement('div', { 'data-edition': props.editionId, 'data-year': props.year, lang: props.locale }) },
  };
  new Function('require','module','exports',code)(id => { assert.ok(Object.hasOwn(deps,id), id); return deps[id]; }, module, module.exports);
  const html = renderToStaticMarkup(module.exports.AdminConsole({ festivals: [], initialChanges: [], parserRuns: [], auditEntries: [], submissions: [], lifecycleTargets: [{ id: 'canonical-test-edition', year: 2027, festival: { slug: 'rock-en-seine', officialUrl: ROCK_EN_SEINE_HOME } }] }));
  assert.match(html, /data-edition="canonical-test-edition" data-year="2027" lang="ru"/);
});
