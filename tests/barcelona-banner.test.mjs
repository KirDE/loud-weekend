import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const html = readFileSync(new URL('./fixtures/barcelona-current-banner.html', import.meta.url), 'utf8');
const source = { festivalSlug: 'barcelona-rock-fest', url: 'https://www.barcelonarockfest.com/', strategies: ['json_ld_event', 'html_fallback'], enabled: true, editionYear: 2027, refreshPolicy: 'daily' };
const parse = (document = html, config = source) => extractFestivalCandidate(document, config, '2026-10-10T15:40:00Z');
test('actual corrected Barcelona banner gives all four days and current sales, never stale FAQ or old lineup images', () => {
  const c = parse();
  assert.equal(c.startDate, '2027-07-01'); assert.equal(c.endDate, '2027-07-04');
  assert.equal(c.ticketsUrl, 'https://www.barcelonarockfest.com/en/tickets'); assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.observedEditionYears, [2027]); assert.deepEqual(c.warnings, []);
  assert.equal(c.lineup, undefined); assert.equal(c.headliners, undefined); assert.equal(c.status, undefined);
  const current = { slug: source.festivalSlug, editionYear: 2027, startDate: c.startDate, endDate: c.endDate, ticketsUrl: c.ticketsUrl, ticketStatus: 'available', status: 'partial', headliners: ['Verified headliner'], lineup: ['Verified support'] };
  const result = evaluateCandidate(current, c); assert.deepEqual(result.changes, []); assert.deepEqual(result.reviewReasons, []);
});
test('later official dates and localized sales change dynamically without a bill or hash allowlist', () => {
  const c = parse(html.replace('1 - 2 - 3 - 4 julio 2027', '5 - 6 - 7 juliol 2028').replace('tickets ya a la venta', 'entrades ja a la venda'), { ...source, editionYear: 2028 });
  assert.equal(c.startDate, '2028-07-05'); assert.equal(c.endDate, '2028-07-07'); assert.equal(c.ticketStatus, 'available');
  const en = parse(html.replace('julio', 'July').replace('tickets ya a la venta', 'Tickets now on sale').replace('/tickets"', '/en/tickets"'));
  assert.equal(en.ticketStatus, 'available'); assert.equal(en.ticketsUrl, 'https://www.barcelonarockfest.com/en/tickets');
});
test('stale, conflicting, nonconsecutive, impossible or unmarked dates cannot establish current dates or sales', () => {
  for (const bad of [html.replace('2027', '2026'), html.replace('1 - 2 - 3 - 4', '1 - 3 - 4'), html.replace('1 - 2 - 3 - 4 julio', '30 - 31 febrero'), html.replace('1 - 2 - 3 - 4', '99'), html.replace('par-2', 'faq-date'), html + '<h2 class="par-2">2 - 3 julio 2027</h2>']) {
    const c = parse(bad); assert.equal(c.startDate, undefined); assert.equal(c.endDate, undefined); assert.equal(c.ticketStatus, undefined);
  }
});
test('old official edition is surfaced to the policy even when current dates and sales are withheld', () => {
  const c = parse(html.replace('2027', '2026'));
  assert.deepEqual(c.observedEditionYears, [2026]);
  const result = evaluateCandidate({ slug: source.festivalSlug, editionYear: 2027, lineup: [], headliners: [] }, c);
  assert.ok(result.reviewReasons.some(reason => reason.includes('2026')));
});
test('tranche exhaustion and ambiguous sales headings do not imply general availability or full sellout', () => {
  for (const notice of ['EARLY BIRD TICKETS SOLD OUT', 'Tickets sold out', 'Tickets on sale soon']) {
    assert.equal(parse(html.replace('tickets ya a la venta', notice)).ticketStatus, undefined);
  }
  assert.equal(parse(html + '<h2 class="par-3">Tickets sold out</h2>').ticketStatus, undefined);
});
test('festival and official-host scope prevent generic headings from affecting other sources', () => {
  for (const config of [{ ...source, festivalSlug: 'other' }, { ...source, url: 'https://example.test/' }]) {
    assert.equal(parse(html, config).startDate, undefined); assert.equal(parse(html, config).ticketStatus, undefined);
  }
});

test('live English banner postposes now and preserves verified catalogue facts', () => {
  const live = html.replace('julio', 'july').replace('tickets ya a la venta', 'tickets on sale now').replace('/tickets"', '/en/tickets"');
  const c = parse(live);
  assert.equal(c.startDate, '2027-07-01'); assert.equal(c.endDate, '2027-07-04');
  assert.equal(c.ticketStatus, 'available'); assert.deepEqual(c.warnings, []);
  const current = { slug: source.festivalSlug, editionYear: 2027, startDate: c.startDate, endDate: c.endDate, ticketsUrl: c.ticketsUrl, ticketStatus: 'available', status: 'partial', headliners: ['Verified headliner'], lineup: ['Verified support'] };
  const result = evaluateCandidate(current, c); assert.deepEqual(result.changes, []); assert.deepEqual(result.reviewReasons, []);
  for (const notice of ['Tickets are on sale now', 'Tickets are now on sale', 'Tickets on sale', 'Tickets are on sale']) {
    assert.equal(parse(live.replace('tickets on sale now', notice)).ticketStatus, 'available');
  }
  for (const notice of ['Tickets on sale now soon', 'Tickets on sale now: early bird sold out', 'Tickets on sale tomorrow', 'Tickets not on sale now']) {
    assert.equal(parse(live.replace('tickets on sale now', notice)).ticketStatus, undefined);
  }
});

test('hidden payloads and footer banners cannot prove current stock or conflict with the visible edition', () => {
  for (const before of ['<script>', '<template>', '<div hidden>', '<div aria-hidden="true">', '<div style="display:none">', '<footer>']) {
    const close=before.startsWith('<script')?'</script>':before.startsWith('<template')?'</template>':before.startsWith('<footer')?'</footer>':'</div>';
    assert.equal(parse(before+html+close).ticketStatus,undefined);
    assert.equal(parse(html+before+'<h2 class="par-2">9 - 10 julio 2026</h2><h2 class="par-3">Tickets sold out</h2>'+close).ticketStatus,'available');
  }
});

test('an enabled official ticket control must corroborate the current onsale banner', () => {
  for (const document of [
    html.replace('/tickets"', 'https://www.barcelonarockfest.com.evil.example/tickets"'),
    html.replace('/tickets"', 'https://user@www.barcelonarockfest.com/tickets"'),
    html.replace('/tickets"', '/tickets?year=2026"'),
    html.replace('/tickets"', '/tickets#archive"'),
    html.replace('<a href=', '<a aria-disabled="true" href='),
    html.replace('<a href=', '<a disabled href='),
    html.replace('<a href=', '<a hidden href='),
    html.replace('<a href=', '<div aria-disabled="true"><a href=')+'</div>',
    html.replace('class="nav-ticket-text">TICKETS','class="nav-ticket-text">Camping'),
  ]) assert.equal(parse(document).ticketStatus,undefined);
});

test('source identity excludes archive routes, userinfo, ports and query overrides', () => {
  for (const url of ['https://www.barcelonarockfest.com/archive','https://user@www.barcelonarockfest.com/','https://www.barcelonarockfest.com:8443/','https://www.barcelonarockfest.com/?year=2026']) {
    assert.equal(parse(html,{...source,url}).ticketStatus,undefined);
  }
});

test('generic JSON-LD never restores unavailable Barcelona stock or unrelated ticket URLs', () => {
  const ld = '<script type="application/ld+json">'+JSON.stringify({'@type':'Event', name:'Barcelona Rock Fest 2027',startDate:'2027-07-01',endDate:'2027-07-04',offers:{'@type':'Offer',availability:'https://schema.org/InStock',url:'https://example.test/tickets'}})+'</script>';
  for (const control of ['<a hidden href=', '<a class="hidden" href=', '<div class="hidden"><a href=', '<a class="disabled" href=']) {
    const c=parse(html.replace('<a href=',control)+ld);
    assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);
  }
  const c=parse('<a href="https://foreign.test/tickets">Tickets</a>'+html+ld);
  assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,'https://www.barcelonarockfest.com/en/tickets');
  assert.ok(c.evidence.find(e=>e.field==='ticketStatus').excerpt.includes('href="/tickets"'));
  assert.ok(c.evidence.find(e=>e.field==='ticketsUrl').excerpt.includes('href="/tickets"'));
});
test('excluded source identity cannot leak generic metadata, links or artists',()=>{
 const generic='<meta property="event:start_time" content="2027-07-01"><span data-artist="Foreign Band">Foreign Band</span>';
 for(const url of ['https://www.barcelonarockfest.com/archive','https://www.barcelonarockfest.com/?year=2026','https://foreign.test/']){
  const c=parse(html+generic,{...source,url});
  for(const f of ['startDate','endDate','ticketsUrl','ticketStatus','lineup']) assert.equal(c[f],undefined,f);
  assert.equal(c.evidence.length,0);
 }
});
test('fetch rejects redirected Barcelona bodies and alternate fetch routes',async()=>{
 const {fetchSource}=await import('../lib/ingestion/fetch.ts');
 for(const url of ['https://www.barcelonarockfest.com/archive','https://foreign.test/']){
  const response=new Response(html);Object.defineProperty(response,'url',{value:url});
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>response}),/identity/);
 }
 await assert.rejects(fetchSource({...source,fetchUrl:'https://foreign.test/'},{maxAttempts:1,fetchImpl:async()=>new Response(html)}),/identity/);
});
