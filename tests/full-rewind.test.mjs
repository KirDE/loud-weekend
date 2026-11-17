import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {fetchSource} from '../lib/ingestion/fetch.ts';import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';import {evaluateCandidate} from '../lib/ingestion/policy.ts';import {validateSource} from '../lib/sources/repository.ts';
import {FULL_REWIND_HOME,FULL_REWIND_BANDS,FULL_REWIND_DOCUMENTS} from '../lib/ingestion/adapters/full-rewind.ts';
const home=await readFile(new URL('./fixtures/full-rewind-home-excerpt.html',import.meta.url),'utf8');
const bands=await readFile(new URL('./fixtures/full-rewind-bands-excerpt.html',import.meta.url),'utf8');
const source={festivalSlug:'full-rewind',url:FULL_REWIND_HOME,editionYear:2027,enabled:true,strategies:['official_markup'],refreshPolicy:'weekly'};
const extract=(h=home,b=bands,s=source)=>extractFestivalCandidate(JSON.stringify({kind:FULL_REWIND_DOCUMENTS,home:h,bands:b}),s,'2026-11-14T20:00:00Z');
const product=await readFile(new URL('./fixtures/ticket-status/full-rewind-weekend.json',import.meta.url),'utf8');
const productUrl='https://full-rewind.de/products/full-rewind-weekend-ticket-2027.js';
const responseFor=u=>new Response(u===FULL_REWIND_HOME?home:u===FULL_REWIND_BANDS?bands:product,{headers:{'content-type':u===productUrl?'text/javascript':'text/html'}});
const current={slug:'full-rewind',name:'Full Rewind',editionYear:2027,headliners:[],lineup:[],status:'tba',city:'Roitzschjora'};
test('registered adapter parses actual unranked 2027 card excerpt despite legacy 2025 URL',()=>{const c=extract();assert.equal(validateSource(source),'official_markup:full-rewind');assert.equal(c.startDate,'2027-08-19');assert.equal(c.endDate,'2027-08-21');assert.equal(c.city,'Roitzschjora');assert.equal(c.lineup.length,16);assert(c.lineup.includes('As I Lay Dying'));assert(c.lineup.includes('Legion of the Damned'));assert(c.lineup.includes('Strength'));assert.equal(c.headliners,undefined);assert.equal(c.status,'partial');assert.equal(c.lineupScope,'announcement');assert.equal(c.ticketsUrl,'https://full-rewind.de/collections/tickets-2027');assert(c.evidence.some(e=>e.field==='lineup'&&e.sourceUrl===FULL_REWIND_BANDS));});
test('wrong edition, malformed dates, missing close, wrong card origin and unrecognized page fail closed',()=>{for(const [h,b,s] of [[home,bands,{...source,editionYear:2028}],[home,bands.replace('Bands 2027','Bands 2026'),source],[home.replace('19.08.','32.08.'),bands,source],[home,bands.replace('</main>',''),source],[home,bands.replace('https://cdn.shopify.com/s/files/1/0778/0528/9815/files/Full-Rewind_Bands_AILD','https://evil.invalid/Full-Rewind_Bands_AILD'),source],[home,bands,{...source,url:'https://other.invalid/'}]]) {const c=extract(h,b,s);assert.equal(c.lineup,undefined);assert(c.warnings.length);}});
test('current edition changed dates surface for review instead of silently retaining old dates',()=>{const c=extract(home.replace('19.08.','18.08.'));assert.equal(c.startDate,'2027-08-18');assert(evaluateCandidate({...current,startDate:'2027-08-19'},c).changes.some(c=>c.kind==='date_changed'&&c.reviewRequired));});
test('artist additions require review; exact replay no-op; partial list preserves saved billing',()=>{const c=extract(),first=evaluateCandidate(current,c);assert(first.reviewReasons.some(r=>r.includes('Full Rewind')));assert.equal(first.publishable,false);const saved={...current,status:'partial',startDate:c.startDate,endDate:c.endDate,ticketsUrl:c.ticketsUrl,lineup:c.lineup};const same=evaluateCandidate(saved,c);assert.deepEqual(same.changes,[]);assert.deepEqual(same.reviewReasons,[]);const partial=evaluateCandidate({...saved,headliners:['Saved Headliner']},{...c,lineup:c.lineup.slice(1)});assert.deepEqual(partial.changes,[]);assert.deepEqual(partial.reviewReasons,[]);const extra=evaluateCandidate(saved,{...c,lineup:[...c.lineup,'New Act']});assert(extra.reviewReasons.length);assert(extra.changes.some(c=>c.after==='New Act'));const ordinary=evaluateCandidate(saved,{...c,lineupScope:undefined,artistListMode:undefined,lineup:c.lineup.slice(1)});assert(ordinary.changes.some(c=>c.kind==='artist_removed'));assert(ordinary.reviewReasons.length);});
test('full-response linked fetch is bounded to exact official bands route and preserves HTTP failures',async()=>{const calls=[];const r=await fetchSource(source,{fetchImpl:async u=>{calls.push(u);return responseFor(u);}});assert.deepEqual(calls,[FULL_REWIND_HOME,FULL_REWIND_BANDS,productUrl]);assert.equal(extractFestivalCandidate(await r.response.text(),source,new Date().toISOString()).lineup.length,16);await assert.rejects(fetchSource(source,{fetchImpl:async()=>new Response(home.replaceAll('/pages/bands_2025','/pages/archive'))}),/bands link missing/);const failed=await fetchSource(source,{maxAttempts:1,fetchImpl:async u=>new Response(u===FULL_REWIND_HOME?home:'error',{status:u===FULL_REWIND_HOME?200:503})});assert.equal(failed.response.status,503);});

test('duplicate and script-only rosters fail closed; genuinely added official cards stay review-gated',()=>{
 const card=bands.match(/<img\b[^>]*alt="Full-Rewind_Bands_AILD"[^>]*>/)[0];
 assert.equal(extract(home,bands.replace('</main>',card+'</main>')).lineup,undefined);
 const cards=[...bands.matchAll(/<img\b[^>]*>/g)].map(m=>m[0]).join('');
 const hidden=bands.replace(/<img\b[^>]*>/g,'').replace('</main>',`<script>${cards}</script></main>`);
 assert.equal(extract(home,hidden).lineup,undefined);
 const added=extract(home,bands.replace('</main>',card.replaceAll('AILD','Another-Band')+'</main>'));
 assert.equal(added.lineup.length,17);assert(evaluateCandidate(current,added).reviewReasons.length);
});


test('linked-fetch exceptions count all completed requests plus failing retries', async () => {
  let calls = 0;
  await assert.rejects(fetchSource(source, { maxAttempts: 3, sleep: async () => {}, fetchImpl: async u => {
    calls++; if (u === FULL_REWIND_HOME) return new Response(home);
    throw new Error('offline');
  }}), error => error.message === 'offline' && error.attempts === 4);
  assert.equal(calls, 4);
  await assert.rejects(fetchSource(source, {fetchImpl: async u => {
    const r = new Response(u === FULL_REWIND_HOME ? home : bands);
    if (u === FULL_REWIND_BANDS) Object.defineProperty(r, 'url', {value: 'https://other.invalid/'});
    return r;
  }}), error => /bands identity changed/.test(error.message) && error.attempts === 2);
  await assert.rejects(fetchSource(source, {fetchImpl: async () => new Response(home.replaceAll('/pages/bands_2025', '/pages/archive'))}), error => error.attempts === 1);
});

test('admin whole-field artist replacement is refused, including stale approvals, before DB mutation', async () => {
  const { assertAdminArtistReviewAllowed } = await import('../lib/catalog/admin-artist-review.ts');
  const { publishAdminFestivalChange } = await import('../lib/catalog/publication.ts');
  for (const field of ['lineup', 'headliners']) {
    assert.throws(() => assertAdminArtistReviewAllowed('full-rewind', [field]), /protected ingestion review/);
    await assert.rejects(publishAdminFestivalChange({}, {change: {
      id: 'stale-change', resourceKey: 'full-rewind', field, beforeValue: ['Saved Artist'], afterValue: ['New Artist'], sourceEvidence: [], parserRunId: 'run',
    }, actorLabel: 'test'}), /protected ingestion review/);
  }
  assert.doesNotThrow(() => assertAdminArtistReviewAllowed('full-rewind', ['startDate', 'endDate']));
  assert.doesNotThrow(() => assertAdminArtistReviewAllowed('other-festival', ['lineup', 'headliners']));
});

async function stockPipeline(body=product,homeDocument=home,options={}) {
 const calls=[];
 const result=await fetchSource(source,{maxAttempts:1,fetchImpl:async(u,request)=>{
   calls.push(u);
   if(u===productUrl) {
     assert.equal(request.headers.authorization,undefined);
     assert.equal(request.redirect,'follow');
     const response=new Response(body,{status:options.status??200,headers:{'content-type':options.type??'text/javascript'}});
     if(options.redirect) Object.defineProperty(response,'url',{value:options.redirect});
     return response;
   }
   return new Response(u===FULL_REWIND_HOME?homeDocument:bands,{headers:{'content-type':'text/html'}});
 }});
 assert.equal(result.attempts,3);
 if(!result.response.ok)return {result,calls};
 return {result,calls,candidate:extractFestivalCandidate(await result.response.text(),source,'2026-11-17T23:38:52Z')};
}

test('official current weekend product inventory supplies stock with collection gateway and exact provenance',async()=>{
 const {candidate:c,calls}=await stockPipeline();
 assert.deepEqual(calls,[FULL_REWIND_HOME,FULL_REWIND_BANDS,productUrl]);
 assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,'https://full-rewind.de/collections/tickets-2027');
 assert(c.evidence.some(e=>e.field==='ticketStatus'&&e.sourceUrl===productUrl&&e.excerpt.includes('available=true')));
 assert.equal(c.lineup.length,16);assert.equal(c.headliners,undefined);
 const saved={...current,...extract(),ticketStatus:'available',ticketsUrl:c.ticketsUrl};
 assert.deepEqual(evaluateCandidate(saved,c).changes,[]);
 assert.deepEqual(evaluateCandidate(saved,c).reviewReasons,[]);
});

test('unavailable Shopify admission never fabricates sold_out from a product boolean',async()=>{
 const p=JSON.parse(product);p.available=false;p.variants[0].available=false;
 const {candidate:c}=await stockPipeline(JSON.stringify(p));
 assert.equal(c.ticketStatus,'unavailable');
 const saved={...current,...extract(),ticketStatus:'available'};
 assert(evaluateCandidate(saved,c).changes.some(change=>change.field==='ticketStatus'&&change.after==='unavailable'));
});

test('malformed, conflicting, future or non-admission inventory is reviewable and preserves last stock',async()=>{
 const cases=[
  p=>{p.available='true';},p=>{p.variants[0].available=false;},
  p=>{p.title='PKW Parkticket 2027';},p=>{p.handle='full-rewind-weekend-ticket-2026';},
  p=>{p.url='/products/full-rewind-weekend-ticket-2026';},
  p=>{p.description=p.description.replace('19. - 21.08.2027','18. - 21.08.2027');},
  p=>{p.description='<div hidden>'+p.description+'</div>';},
  p=>{p.variants=[];},p=>{p.variants.push({...p.variants[0]});},
  p=>{p.variants[0].sku='PKW Parkticket 2027';},
  p=>{p.variants[0].quantity_rule.max=0;},
  p=>{p.requires_selling_plan=true;},
  p=>{p.variants[0].price=0;},
 ];
 for(const change of cases){
  const p=JSON.parse(product);change(p);
  const {candidate:c}=await stockPipeline(JSON.stringify(p));
  assert.equal(c.ticketStatus,undefined);assert(c.warnings.some(w=>w.includes('requires review')));
  const evaluated=evaluateCandidate({...current,...extract(),ticketStatus:'available'},c);
  assert.equal(evaluated.publishable,false);
  assert(!evaluated.changes.some(change=>change.field==='ticketStatus'));
 }
 const {candidate:c}=await stockPipeline('<html>Block page</html>');
 assert.equal(c.ticketStatus,undefined);assert(c.warnings.length);
 const {candidate:drift}=await stockPipeline(product,home.replace('19.08.','18.08.'));
 assert.equal(drift.ticketStatus,undefined);
});

test('public product transport propagates failure and rejects redirected or mislabeled content',async()=>{
 for(const status of [403,404,429,503])assert.equal((await stockPipeline('blocked',home,{status})).result.response.status,status);
 await assert.rejects(stockPipeline(product,home,{redirect:'https://elsewhere.example/product.js'}),/changed identity/);
 for(const type of ['text/html','text/plain'])await assert.rejects(stockPipeline(product,home,{type}),/non-JSON/);
 const {candidate:c}=await stockPipeline(product,home,{type:'application/json'});
 assert.equal(c.ticketStatus,'available');
});
