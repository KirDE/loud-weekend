import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {observeTicketSupplement,ticketSupplementUrl,ticketSupplementPurchaseUrl} from '../lib/ingestion/ticket-supplements.ts';
import {ALCATRAZ_STOCK,ALCATRAZ_PURCHASE,ALCATRAZ_SHOP,alcatrazProof} from './fixtures/ticket-status/alcatraz-reviewed-proof.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=readFileSync(new URL('./fixtures/ticket-status/alcatraz-public-stock.json',import.meta.url),'utf8');
const home=readFileSync(new URL('./fixtures/official-markup/alcatraz-current-banner.html',import.meta.url),'utf8');
const source=parserSource('alcatraz',{url:'https://www.alcatraz.be/',alcatrazProof,strategies:['json_ld_event','html_fallback']});
const dates={startDate:'2027-08-05',endDate:'2027-08-08',fetchedAt:'2026-11-22T12:50:00Z'};
const pass=p=>Object.values(p.tickets).find(t=>t?.name==='Combi - Wave 3');
test('Alcatraz: actual public ordinary Combi Wave 3 available despite sold-out early waves/VIP',()=>{
 const o=observeTicketSupplement(fixture,source,ALCATRAZ_STOCK,dates);assert.equal(o.status,'available',o.warning);assert.equal(o.ticketsUrl,ALCATRAZ_PURCHASE);
 assert.equal(ticketSupplementUrl(source),ALCATRAZ_STOCK);assert.equal(ticketSupplementPurchaseUrl(source),ALCATRAZ_PURCHASE);
 for(const override of [{url:'https://foreign.test/'},{fetchUrl:source.url},{followLinkPattern:'^/tickets/$'},{strategies:['manual_review']},{editionYear:2028}])assert.equal(ticketSupplementUrl({...source,...override}),undefined);
});
for(const [name,change]of[
 ['foreign shop',p=>p.shops[0].guid='foreign-shop'],
 ['wrong shop year',p=>p.shops[0].name='Alcatraz Open Air 2026'],
 ['duplicate shop',p=>p.shops.push({...p.shops[0]})],
 ['foreign ticket event',p=>pass(p).event_id=p.events.find(e=>/CAMPING/.test(e.name)).guid],
 ['old event dates',p=>p.events.find(e=>e.name==='Alcatraz Open Air 2027').start='2026-08-05T09:00:00+02:00'],
 ['cancelled event',p=>p.events.find(e=>e.name==='Alcatraz Open Air 2027').status='cancelled'],
 ['camping instead of combi',p=>pass(p).name='Camping'],
 ['coupon required',p=>pass(p).require_coupon=true],
 ['coupon-hidden pass',p=>pass(p).hide_without_coupon=true],
 ['deleted pass',p=>pass(p).deleted_at='2026-11-22T00:00:00Z'],
 ['not-yet-on-sale pass',p=>pass(p).available_from='2027-01-01T00:00:00Z'],
 ['expired sale',p=>pass(p).available_until='2026-11-21T00:00:00Z'],
 ['invalid sale date',p=>pass(p).available_from='not-a-date'],
 ['unknown status',p=>pass(p).status='unknown'],
 ['unavailable combi, other entry unknown',p=>pass(p).status='sold_out'],
 ['manual status override',p=>pass(p).status_overrule='available'],
 ['invalid price',p=>pass(p).min_price='26500'],
 ['invalid order quantity',p=>pass(p).max_orderable_amount_per_order=0],
 ['detached ticket',p=>p.pivots['shops-tickets']=p.pivots['shops-tickets'].filter(x=>x.ticket_guid!==pass(p).guid)],
 ['foreign pivot',p=>p.pivots['shops-tickets'].find(x=>x.ticket_guid===pass(p).guid).shop_guid='foreign-shop'],
 ['conditional purchase',p=>p.pivots['shops-tickets'].find(x=>x.ticket_guid===pass(p).guid).preceded_by='another-ticket'],
 ['duplicated ordinary product',p=>p.tickets['duplicate']={...pass(p)}],
 ['null ordinary ticket',p=>p.tickets[pass(p).guid]=null],
 ['only side products',p=>p.tickets=Object.fromEntries(Object.entries(p.tickets).filter(([,v])=>/Camping|VIP/.test(v.name)))],
])test(`Alcatraz: ${name} fails closed without a global sellout`,()=>{
 const p=JSON.parse(fixture);change(p);const o=observeTicketSupplement(JSON.stringify(p),source,ALCATRAZ_STOCK,dates);assert.equal(o.status,undefined);assert.ok(o.warning);
});
test('Alcatraz: primary edition/date/check time remains mandatory',()=>{
 for(const d of [undefined,{...dates,startDate:'2026-08-05'},{...dates,endDate:'2027-08-09'},{...dates,fetchedAt:undefined}])assert.equal(observeTicketSupplement(fixture,source,ALCATRAZ_STOCK,d).status,undefined);
});
async function pipeline(options={}){
 const seen=[];const result=await fetchSource({...source,headers:{authorization:'synthetic-only'}},{maxAttempts:1,fetchImpl:async (url,init)=>{
  seen.push(String(url));assert.ok([source.url,ALCATRAZ_STOCK].includes(String(url)));assert.ok(!/reserve|cart|checkout|order/.test(String(url)));
  if(url===ALCATRAZ_STOCK)assert.equal(init.headers.authorization,undefined);
  const r=new Response(url===source.url?home:fixture,{status:url===ALCATRAZ_STOCK?(options.status??200):200,headers:{'content-type':url===source.url?'text/html':options.type??'application/json'}});
  Object.defineProperty(r,'url',{value:url===source.url?(options.primaryUrl??'https://www.alcatraz.be/en/'):(options.stockUrl??ALCATRAZ_STOCK)});
  return r;
 }});return{seen,result};
}
test('Alcatraz: normal official root→English redirect and public GET API form one real producer',async()=>{
 const{seen,result}=await pipeline();assert.deepEqual(seen,[source.url,ALCATRAZ_STOCK]);assert.equal(result.attempts,2);
 const c=extractFestivalCandidate(await result.response.text(),source,dates.fetchedAt);assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,ALCATRAZ_PURCHASE);assert.deepEqual(c.warnings,[]);assert.equal(c.lineup,undefined);
 assert.ok(c.evidence.filter(e=>['ticketStatus','ticketsUrl'].includes(e.field)).every(e=>e.sourceUrl===ALCATRAZ_STOCK));
});
test('Alcatraz: unexpected redirect/media/error is not a healthy empty inventory check',async()=>{
 for(const primaryUrl of ['https://foreign.test/en/','https://www.alcatraz.be/en/history'])await assert.rejects(pipeline({primaryUrl}),/changed identity/);
 await assert.rejects(pipeline({stockUrl:'https://foreign.test/data'}),/changed identity/);
 await assert.rejects(pipeline({type:'text/html'}),/non-HTML/);
 for(const status of [403,429,503])assert.equal((await pipeline({status})).result.response.status,status);
});
