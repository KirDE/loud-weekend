import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {ticketSupplementUrl,ticketSupplementPurchaseUrl} from '../lib/ingestion/ticket-supplements.ts';
import {observeResurrectionStock,RESURRECTION_CONFIG,RESURRECTION_SHOP,RESURRECTION_PRODUCTS,RESURRECTION_PURCHASE,RESURRECTION_DOCUMENTS,RESURRECTION_NAMESPACE,RESURRECTION_PRODUCT_ID} from '../lib/ingestion/resurrection-ticket-stock.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=name=>readFileSync(new URL('./fixtures/ticket-status/'+name,import.meta.url),'utf8');
const home=fixture('resurrection-primary.html'),config=JSON.parse(fixture('resurrection-public-config.json')),shop=JSON.parse(fixture('resurrection-public-shop.json')),products=JSON.parse(fixture('resurrection-public-products.json'));
const source=parserSource('resurrection-fest',{url:'https://www.resurrectionfest.es/',strategies:['html_fallback']});
const payload=()=>structuredClone({kind:RESURRECTION_DOCUMENTS,configUrl:RESURRECTION_CONFIG,shopUrl:RESURRECTION_SHOP,productsUrl:RESURRECTION_PRODUCTS,config,shop,products});
const ordinary=p=>p.products.data.find(x=>x.name==='4 Day Ticket / Abono 4 días');
test('Resurrection: actual current regular four-day inventory beats sold-out Early Birds and guest products',()=>{
 const p=payload(),o=observeResurrectionStock(JSON.stringify(p));assert.equal(o.status,'available',o.warning);assert.ok(o.excerpt.includes('not total capacity'));
 assert.equal(ticketSupplementUrl(source),RESURRECTION_PRODUCTS);assert.equal(ticketSupplementPurchaseUrl(source),RESURRECTION_PURCHASE);
 ordinary(p).almostSoldOut=true;assert.equal(observeResurrectionStock(JSON.stringify(p)).status,'low');
});
for(const[name,change]of[
 ['foreign config document',p=>p.configUrl='https://foreign.test/config'],
 ['archived event',p=>p.config.data.shopSale.title='Resurrection Fest 2026'],
 ['foreign namespace',p=>p.config.data.shopSale.namespace='another_2027_event'],
 ['same-year but different public sale namespace',p=>p.config.data.shopSale.namespace=RESURRECTION_NAMESPACE+'Other'],
 ['login restricted',p=>p.config.data.shopSale.requireLogin=true],
 ['premium restricted',p=>p.config.data.shopSale.requirePremiumMembership=true],
 ['unknown shop mode',p=>p.config.data.shopSale.shopMode='wishlist'],
 ['shop closed',p=>p.shop.data.isOpen=false],
 ['read-only shop',p=>p.shop.data.isReadOnly=true],
 ['queued shop',p=>p.shop.data.paymentQueueEnabled=true],
 ['upgrade shop',p=>p.shop.data.isUpgradeShop=true],
 ['non-EUR shop',p=>p.shop.data.currency='USD'],
 ['guest only',p=>p.products.data=p.products.data.filter(x=>/GUEST/.test(x.name))],
 ['ordinary soldout, other inventory unknown',p=>{ordinary(p).soldOut=true;ordinary(p).stockAvailable=0;}],
 ['conflicting soldout/stock',p=>ordinary(p).soldOut=true],
 ['insufficient stock',p=>ordinary(p).stockAvailable=0],
 ['changed price schema',p=>ordinary(p).price='235'],
 ['duplicate ordinary admission',p=>p.products.data.push({...ordinary(p)})],
 ['changed product binding',p=>ordinary(p).id='another-product'],
 ['guest admission label spoof',p=>ordinary(p).claimFlow='guest'],
 ['upgrade product',p=>ordinary(p).isUpgrade=true],
 ['day restriction',p=>ordinary(p).restrictsToDay='wednesday'],
 ['camping category',p=>ordinary(p).categories=[{en:'CAMPING'}]],
])test(`Resurrection: ${name} fails closed without inventing global sellout`,()=>{const p=payload();change(p);const o=observeResurrectionStock(JSON.stringify(p));assert.equal(o.status,undefined);assert.ok(o.warning);});
async function pipeline(p=payload(),options={}){
 const calls=[];const pages=new Map([[source.url,home],[RESURRECTION_CONFIG,JSON.stringify(p.config)],[RESURRECTION_SHOP,JSON.stringify(p.shop)],[RESURRECTION_PRODUCTS,JSON.stringify(p.products)]]);
 const result=await fetchSource({...source,headers:{authorization:'synthetic-only'}},{maxAttempts:1,fetchImpl:async(url,init)=>{
  calls.push(String(url));assert.ok(pages.has(String(url)),'unexpected endpoint');assert.ok(!/cart|order|reserve|queue|checkout/.test(String(url)));
  assert.ok(init.method===undefined||init.method==='GET');
  if(url!==source.url)assert.equal(init.headers.authorization,undefined);
  if([RESURRECTION_SHOP,RESURRECTION_PRODUCTS].includes(url))assert.equal(init.headers['x-event-namespace'],p.config.data.shopSale.namespace);
  const r=new Response(pages.get(String(url)),{status:options.fail===url?403:200,headers:{'content-type':url===source.url?'text/html':options.media===url?'text/html':'application/json'}});
  if(options.redirect===url)Object.defineProperty(r,'url',{value:'https://foreign.test/'});
  return r;
 }});return{result,calls};
}
test('Resurrection: GET-only current public config+shop+products produce durable stock and a human purchase URL',async()=>{
 const{result,calls}=await pipeline();assert.equal(result.attempts,4);assert.deepEqual(calls,[source.url,RESURRECTION_CONFIG,RESURRECTION_SHOP,RESURRECTION_PRODUCTS]);
 const c=extractFestivalCandidate(await result.response.text(),source,'2026-11-22T12:38:00Z');assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,RESURRECTION_PURCHASE);assert.deepEqual(c.ticketSupplement.scope,{namespace:RESURRECTION_NAMESPACE,productId:RESURRECTION_PRODUCT_ID});assert.deepEqual(c.warnings,['Resurrection festival lineup image requires review: no individual performer markup']);
 assert.ok(c.evidence.filter(e=>e.field==='ticketStatus'||e.field==='ticketsUrl').every(e=>e.sourceUrl===RESURRECTION_PRODUCTS));
});
for(const endpoint of [RESURRECTION_CONFIG,RESURRECTION_SHOP,RESURRECTION_PRODUCTS])test('Resurrection: HTTP/media/redirect failure at '+endpoint,async()=>{
 for(const option of ['fail','media','redirect'])await assert.rejects(pipeline(payload(),{[option]:endpoint}),/HTTP 403|media type|redirected/);
});
test('Resurrection: active queue/closed shop stops before inventory; access restriction stops before shop requests',async()=>{
 for(const[name,change]of [['queue',p=>p.shop.data.paymentQueueEnabled=true],['closed',p=>p.shop.data.isOpen=false],['restricted',p=>p.config.data.shopSale.requireLogin=true]]){
  const p=payload();change(p);await assert.rejects(pipeline(p),/queued|closed|access mode/);
 }
});

test('Resurrection: image-only artist review is retained and waived only for proven independent unchanged-date ticket metadata',async()=>{
 const{result}=await pipeline();const c=extractFestivalCandidate(await result.response.text(),source,'2026-11-22T12:38:00Z');
 const current={slug:source.festivalSlug,name:'Synthetic',country:'Testland',countryCode:'DE',officialUrl:source.url,genres:[],headliners:[],lineup:[],status:'partial',ticketStatus:'unknown',startDate:c.startDate,endDate:c.endDate,editionYear:2027,updatedAt:'2026-01-01T00:00:00Z'};
 assert.equal(evaluateCandidate(current,c).publishable,true);
 for(const change of [
  {lineup:['Unexpected Artist']}, {headliners:['Unexpected Artist']}, {sourceUrl:'https://foreign.test/'},
  {observedEditionYears:[2026]}, {ticketSupplement:undefined}, {ticketSupplement:{...c.ticketSupplement,scope:undefined}}, {ticketSupplement:{...c.ticketSupplement,scope:{...c.ticketSupplement.scope,namespace:'other-sale'}}}, {warnings:[...c.warnings,'Source identity changed']},
  {startDate:'2027-06-29'},
 ])assert.equal(evaluateCandidate(current,{...c,...change}).publishable,false,JSON.stringify(change));
});
