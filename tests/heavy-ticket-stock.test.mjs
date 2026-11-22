import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {heavyMetadata,heavyStockHtml,heavyStockResponse} from './support/heavy-stock-fixture.ts';
import {HEAVY_WIDGET,HEAVY_WIDGET_API,HEAVY_STOCK,HEAVY_PURCHASE,HEAVY_STOCK_DOCUMENTS,heavyRenderAction,reduceHeavyStockDocument,observeHeavyStock} from '../lib/ingestion/heavy-ticket-stock.ts';
import {ticketSupplementUrl} from '../lib/ingestion/ticket-supplements.ts';
const dates={startDate:'2027-06-04',endDate:'2027-06-06'};
const meta=heavyRenderAction(heavyMetadata()).meta;
const doc=(html=heavyStockHtml)=>({kind:HEAVY_STOCK_DOCUMENTS,apiUrl:HEAVY_WIDGET_API,renderUrl:HEAVY_STOCK,meta,html});
const observe=(d=doc(),dts=dates)=>observeHeavyStock(JSON.stringify(d),dts);
const primary=JSON.parse(readFileSync(new URL('./fixtures/official-markup/heavy-weekend-linked-2027.json',import.meta.url),'utf8'));
const logo=readFileSync(new URL('./fixtures/official-markup/heavy-slash-logo.png',import.meta.url));
const source={festivalSlug:'heavy-weekend',url:'https://www.heavyweekend.live/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};
const primaryResponse=url=>url===source.url?new Response(primary.home):String(url).includes('cdn.prod')?new Response(logo):new Response(primary.documents.find(d=>d.url===url).html);
test('actual ordinary unrestricted pass has independently bound public stock and human purchase URL',()=>{
 assert.equal(observe().status,'available');assert.equal(observe().ticketsUrl,HEAVY_PURCHASE);
 assert.ok(observe().excerpt.includes('rate5629650'));assert.equal(ticketSupplementUrl(source),HEAVY_STOCK);
 for(const s of [{...source,editionYear:2026},{...source,fetchUrl:source.url},{...source,followLinkPattern:'tickets'},{...source,url:source.url+'other'}])assert.equal(ticketSupplementUrl(s),undefined);
 for(const d of [{...doc(),renderUrl:HEAVY_STOCK+'&foreign=1'},{...doc(),apiUrl:'https://evil.invalid'},{...doc(),meta:{...meta,eventId:1}},{...doc(),meta:{...meta,currency:'GBP'}}])assert.equal(observe(d).status,undefined);
 assert.equal(observe(doc(),{...dates,endDate:'2027-06-07'}).status,undefined);
});
const htmlCases=[
 ['disabled fieldset ancestor',s=>'<fieldset disabled>'+s+'</fieldset>'],
 ['aria-disabled ancestor',s=>'<div aria-disabled="true">'+s+'</div>'],
 ['disabled class ancestor',s=>'<div class="disabled">'+s+'</div>'],
 ['disabled ordinary',s=>s.replace('<select ','<select disabled ')],
 ['hidden rate',s=>s.replace('<table ','<table hidden ')],
 ['hidden header',s=>s.replace('data-id="1901845"','hidden data-id="1901845"')],
 ['css-hidden parent',s=>'<div style="display:none">'+s+'</div>'],
 ['missing qty1',s=>s.replace(/<option value="1"[^>]*>[^<]*<\/option>/,'')],
 ['disabled qty1',s=>s.replace('value="1"','disabled value="1"')],
 ['aria-disabled qty1',s=>s.replace('value="1"','aria-disabled="true" value="1"')],
 ['already selected quantity',s=>s.replace('value="1"','selected value="1"')],
 ['foreign rate',s=>s.replaceAll('5629650','5629651')],
 ['group-only label',s=>s.replace('3-DAY PASS - STANDARD - FREE SEATING/STANDING','3-DAY PASS - FRIENDS min 3')],
 ['VIP-only label',s=>s.replace('3-DAY PASS - STANDARD - FREE SEATING/STANDING','3-DAY PASS - GOLD VIP')],
 ['old primary category',s=>s.replace('3-DAY PASS','1-DAY PASS')],
 ['foreign category',s=>s.replaceAll('p_1873636','p_9999999')],
 ['contradictory stock',s=>s.replace('FREE SEATING/STANDING','FREE SEATING/STANDING SOLD OUT')],
 ['zero price',s=>s.replace('data-value="199"','data-value="0"')],
 ['currency mismatch',s=>s.replace('€199.00','£199.00')],
 ['price mismatch',s=>s.replace('data-prix="199"','data-prix="198"')],
 ['duplicate stock table',s=>s+s],
];
for(const[name,mutate]of htmlCases)test(name+' fails closed',()=>assert.equal(observe(doc(mutate(heavyStockHtml))).status,undefined));
test('DOM reduction removes unneeded session/form/telemetry content before persistence',()=>{
 const raw=heavyStockHtml.replace('<select ','<input name="csrf" value="synthetic-do-not-store"><script>session="synthetic"</script><select ');
 const safe=reduceHeavyStockDocument(raw);assert.doesNotMatch(safe,/csrf|session|synthetic|input|script/i);assert.equal(observe(doc(safe)).status,'available');
});
for(const[name,changes]of [['wrong event',{event_id:1}],['wrong widget',{widget_key:'other'}],['not allowed',{access:false}],['wrong rank',{rank:2}],['expired',{exp:1}],['future not-before',{nbf:9999999999}],['customer payload',{widget_data:{customer:'synthetic'}}],['unexpected claim',{unknown:true}]])test('render token '+name+' is not forwarded',()=>assert.throws(()=>heavyRenderAction(heavyMetadata(changes)),/contract/));
test('public action must be exactly reviewed metadata render, never checkout/quantity',()=>{
 for(const mutate of [d=>d.widget_key='other',d=>d.widget_events[0].event.start_date='2026-06-04T15:30:00Z',d=>d.first_step.slug='order',d=>d.first_step.data.actions[0].args[0].url='https://evil.invalid/',d=>d.first_step.data.actions[0].args[0].query.id_evenement=1,d=>d.first_step.data.actions[0].args[0].parameters.quantity=1]){const d=heavyMetadata();mutate(d);assert.throws(()=>heavyRenderAction(d),/contract/);}
});
test('10-request real producer path forwards only metadata token and never persists it',async()=>{
 let renders=0;const input=heavyMetadata(),token=input.first_step.data.actions[0].args[0].parameters.token;
 const fetched=await fetchSource({...source,headers:{authorization:'synthetic-private',cookie:'synthetic-private'}},{maxAttempts:1,fetchImpl:async(url,init)=>{
  if(url===HEAVY_WIDGET_API){assert.equal(init.headers.authorization,undefined);assert.equal(init.headers.cookie,undefined);return Response.json(input);}
  if(url===HEAVY_STOCK){renders++;assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,undefined);assert.deepEqual([...new URLSearchParams(init.body)],[['token',token]]);return new Response(heavyStockHtml,{headers:{'content-type':'text/html'}});}
  return primaryResponse(url);
 }});assert.equal(fetched.attempts,10);assert.equal(renders,1);
 const body=await fetched.response.text();assert.ok(!body.includes(token));assert.doesNotMatch(body,/synthetic-private|csrf|<form|<input/);
 const c=extractFestivalCandidate(body,source,'2026-11-22T14:00:00Z');assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,HEAVY_PURCHASE);assert.deepEqual(c.warnings,[]);
});
test('bad metadata never triggers render; render transport failures never retry or become healthy stock',async()=>{
 for(const mode of ['metadata','http','redirect','media','size','network']){
  let renders=0;const task=()=>fetchSource(source,{maxAttempts:3,sleep:async()=>{},fetchImpl:async(url,init)=>{
   if(url===HEAVY_WIDGET_API){const data=heavyMetadata();if(mode==='metadata')data.first_step.data.actions[0].args[0].parameters.quantity=1;return Response.json(data);}
   if(url===HEAVY_STOCK){renders++;if(mode==='network')throw new Error('offline');const r=new Response(mode==='size'?'x'.repeat(2000001):heavyStockHtml,{status:mode==='http'?403:200,headers:{'content-type':mode==='media'?'application/json':'text/html'}});if(mode==='redirect')Object.defineProperty(r,'url',{value:'https://evil.invalid/'});return r;}
   return primaryResponse(url);
  }});
  if(mode==='http'){const r=await task();assert.equal(r.response.status,403);assert.equal(r.attempts,10);}else await assert.rejects(task,/Heavy|limit|offline/);
  assert.equal(renders,mode==='metadata'?0:1);
 }
});
