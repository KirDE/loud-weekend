import test from 'node:test';
import assert from 'node:assert/strict';
import { impericonFixture, impericonCurrentSource as source, impericonTicketResponse, impericonTicketFixture, impericonTicketUrl } from './support/impericon-current.ts';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { discoverImpericonAnnouncements, impericonTicketProducts } from '../lib/ingestion/adapters/impericon-current.ts';
const at='2026-10-18T15:00:00Z';
const current={slug:'impericon',editionYear:2027,startDate:'2027-06-25',endDate:'2027-06-26',status:'partial',headliners:['Sample Artist'],lineup:['Support One']};
const extract=(e=impericonFixture(),s=source)=>extractFestivalCandidate(JSON.stringify(e),s,at);
const reject=e=>{const c=extract(e);assert.equal(c.headliners,undefined);assert.equal(evaluateCandidate(current,c).publishable,false);assert.match(c.warnings.join(),/no trustworthy/);};
test('new headliner is discovered without changing a fixed post/name list; songs and merchandise are excluded',()=>{
 const c=extract();assert.deepEqual(c.headliners,['Beartooth','Sample Artist']);assert.deepEqual(c.lineup,['Support One']);assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes.map(c=>[c.kind,c.after]),[['headliner_added','Beartooth']]);assert.equal(r.publishable,true);
 assert.deepEqual(extract(impericonFixture('Future Collective')).headliners,['Future Collective','Sample Artist']);
});
test('additive announcement does not remove earlier acts when older posts rotate out of listing',()=>{
 const e=impericonFixture();e.home=e.home.replace(/<a href="[^"]+-new-line-up-wave">[^<]+<\/a>/,'');e.articles.splice(1,1);
 const r=evaluateCandidate({...current,lineup:['Support One','Previously Confirmed']},extract(e));assert.ok(!r.changes.some(c=>c.kind.endsWith('_removed')));
});
test('successful unchanged check is quiet; changed dates and known billing promotions require review',()=>{
 const c=extract();assert.deepEqual(evaluateCandidate({...current,headliners:c.headliners},c).changes,[]);
 assert.ok(evaluateCandidate(current,extract(impericonFixture('Beartooth','24'))).reviewReasons.some(r=>/date|confirmation/i.test(r)));
 assert.ok(evaluateCandidate({...current,lineup:['Beartooth','Support One']},c).reviewReasons.some(r=>/billing promotion/i.test(r)));
});
test('wrong edition, conflicting dates, incomplete pages and changed article markup fail closed',()=>{
 reject(impericonFixture('Future','25',2026));
 for(const change of [e=>{e.home=e.home.slice(0,-8);},e=>{e.articles[0].html=e.articles[0].html.replace('article__content"','missing"');},e=>{e.articles[0].html=e.articles[0].html.replace('Impericon Festival 2027:','Impericon Festival 2026:');},e=>{e.home=e.home.replace('25/26.06.2027','30/31.02.2027');}]){const e=impericonFixture();change(e);reject(e);}
});
test('unknown announcement and unsafe/noncanonical URLs are not silently treated as unchanged',()=>{
 const e=impericonFixture();e.articles[0].html=e.articles[0].html.replace(/<p>[\s\S]*?<\/p>/,'<p>Unrecognised announcement markup.</p>').replace(/<p>As headliners[\s\S]*?<\/p>/,'').replace(/<p>Our previous[\s\S]*?<\/p>/,'');reject(e);
 const bad=impericonFixture();bad.articles[0].html=bad.articles[0].html.replace('rel="canonical" href="https://www.impericon.com','rel="canonical" href="https://evil.example');reject(bad);
 assert.throws(()=>discoverImpericonAnnouncements(impericonFixture().home.replaceAll('/blogs/festival/','/not-a-blog/'),2027));
});
test('fetch follows only discovered official edition articles and exact same-article blog alias redirects',async()=>{
 const e=impericonFixture();const calls=[];const alias=e.articles[0].url.replace('/festival/','/magazine/');
 const f=async(url,opts)=>{calls.push(url);const ticket=impericonTicketResponse(url);if(ticket)return ticket;if(url===source.url)return new Response(e.home);if(url===e.articles[0].url)return new Response('',{status:302,headers:{location:alias}});const d=e.articles.find(d=>d.url===url||url===alias);assert.ok(d);assert.notEqual(opts.redirect,'follow');return new Response(d.html);};
 const result=await fetchSource(source,{fetchImpl:f,maxAttempts:1});assert.equal(result.attempts,6);assert.equal(extractFestivalCandidate(await result.response.text(),source,at).headliners[0],'Beartooth');
 assert.equal(calls.filter(u=>u===source.url).length,1);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=>url===source.url?new Response(e.home):new Response('',{status:302,headers:{location:'https://evil.example/'}})}),/redirected outside/);
});

test('a later support-only wave remains importable after headliner posts rotate out',()=>{
 const e=impericonFixture();e.home=e.home.replace(/<a href="[^"]+-new-headliner">[^<]+<\/a>/,'');e.articles.shift();
 e.articles[0].html=e.articles[0].html.replace(/<p>Our headliners[\s\S]*?<\/p>/,'').replace('<b>Support One</b>','<b>Support One</b> – prior act. <b>Future Collective</b>');
 const c=extract(e);assert.deepEqual(c.warnings,[]);assert.equal(c.headliners,undefined);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes.map(c=>[c.kind,c.after]),[['artist_added','Future Collective']]);assert.equal(r.publishable,true);
});

function ticketEnvelope(product=JSON.parse(impericonTicketFixture),e=impericonFixture()){
 e.ticketProducts=impericonTicketProducts(e.home,2027).map(d=>({url:d.url,product}));
 return e;
}
test('real public Shopify weekend JSON adds source-backed inventory, not prose or VIP stock',()=>{
 const c=extract(ticketEnvelope());
 assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,impericonTicketUrl.slice(0,-3));
 assert(c.evidence.some(e=>e.field==='ticketStatus'&&e.excerpt.includes(impericonTicketUrl)));
 assert.deepEqual(c.headliners,['Beartooth','Sample Artist']);
 const saved={...current,headliners:c.headliners,ticketStatus:'available',ticketsUrl:c.ticketsUrl};
 assert.deepEqual(evaluateCandidate(saved,c).changes,[]);
});
test('unavailable price tier, contradictory booleans and non-weekend inventory retain last-good state for review',()=>{
 const cases=[p=>{p.available=false;p.variants[0].available=false;},p=>{p.available='true';},
 p=>{p.variants[0].available=false;},p=>{p.title='VIP Upgrade 2027';},p=>{p.handle='not-current';},
 p=>{p.url='/products/other';},p=>{p.vendor='Other';},p=>{p.type='Merchandise';},
 p=>{p.variants=[];},p=>{p.variants.push({...p.variants[0]});},p=>{p.requires_selling_plan=true;},
 p=>{p.variants[0].quantity_rule.max=0;},p=>{p.price=0;}];
 for(const mutate of cases){
  const p=JSON.parse(impericonTicketFixture);mutate(p);const c=extract(ticketEnvelope(p));
  assert.equal(c.ticketStatus,undefined);assert(c.warnings.some(w=>w.includes('inventory requires review')));
  assert.equal(evaluateCandidate({...current,ticketStatus:'available'},c).publishable,false);
 }
 const e=ticketEnvelope();e.ticketProducts[0].url='https://other.example/product.js';assert.equal(extract(e).ticketStatus,undefined);
});
test('weekend purchase discovery ignores hidden/foreign/disabled/archive controls, not arbitrary shop URLs',()=>{
 const e=impericonFixture();
 for(const h of [
  e.home.replace('<span class="product-item-meta__title"','<span hidden class="product-item-meta__title"'),
  e.home.replace('<span class="product-item-meta__title"','<span style="display:none" class="product-item-meta__title"'),
 ])assert.deepEqual(impericonTicketProducts(h,2027),[]);
 for(const value of [
  e.home.replace('href="/products/','aria-disabled="true" href="/products/'),
  e.home.replace('href="/products/','href="https://evil.example/products/'),
  e.home.replace('href="/products/','href="https://user@www.impericon.com/products/'),
  e.home.replace('2-preisstufe-weekend-ticket"','2-preisstufe-weekend-ticket?year=2026"'),
 ])assert.throws(()=>impericonTicketProducts(value,2027),/missing or ambiguous/);
 const none={...e,ticketProducts:[]};assert.equal(extract(none).ticketStatus,undefined);assert(extract(none).warnings.length);
});
test('later current price stage and edition are discovered from source, never frozen to stage two',()=>{
 const e=impericonFixture('Later Act','25',2028);
 e.home=e.home.replace('2. Preisstufe','3. Preisstufe').replace('2-preisstufe','3-preisstufe');
 const p=JSON.parse(impericonTicketFixture);
 for(const key of ['title','handle','url'])p[key]=p[key].replaceAll('2027','2028').replace('2. Preisstufe','3. Preisstufe').replace('2-preisstufe','3-preisstufe');
 p.variants[0].name=p.title;
 const expected=impericonTicketProducts(e.home,2028);assert.equal(expected.length,1);
 e.ticketProducts=[{url:expected[0].url,product:p}];
 assert.equal(extractFestivalCandidate(JSON.stringify(e),{...source,editionYear:2028},at).ticketStatus,'available');
});
test('public product request failure is not an empty healthy festival check',async()=>{
 const e=impericonFixture();
 const mock=(body,status=200,type='text/javascript',target)=>async u=>{
  if(u===source.url)return new Response(e.home);
  if(u===impericonTicketUrl){const r=new Response(body,{status,headers:{'content-type':type}});if(target)Object.defineProperty(r,'url',{value:target});return r;}
  const a=e.articles.find(a=>a.url===u);assert(a);return new Response(a.html);
 };
 for(const status of [403,404,429,503]){
  const r=await fetchSource(source,{maxAttempts:1,fetchImpl:mock('blocked',status)});
  assert.equal(r.response.status,status);assert.equal(r.attempts,5);
 }
 for(const [body,type,target] of [['{}','text/html'],['{}','text/javascript','https://other.example/x'],['not-json','text/javascript']]){
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:mock(body,200,type,target)}),e=>e.attempts===5);
 }
});
