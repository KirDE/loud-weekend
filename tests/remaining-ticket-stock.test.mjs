import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ticketSupplementUrl, ticketSupplementPurchaseUrl, observeTicketSupplement, TICKET_SUPPLEMENT } from "../lib/ingestion/ticket-supplements.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { parserSource } from "./support/parser-source.ts";
const at="2026-11-22T12:25:00Z";
const fixtures = Object.fromEntries(["2000trees","pinkpop","eurockeennes","jera"].map(n=>[n,readFileSync(new URL(`./fixtures/ticket-status/${n}-ordinary-stock.${n==='jera'?'json':'html'}`,import.meta.url),'utf8')]));
export const cases = [
 ["2000trees","https://2000trees.co.uk/","2000trees"],
 ["pinkpop","https://www.pinkpop.nl/","pinkpop"],
 ["eurockeennes","https://www.eurockeennes.fr/","eurockeennes"],
 ["jera-on-air","https://www.jeraonair.nl/en/info/","jera"],
];
for(const [slug,url,key] of cases){
 const source=parserSource(slug,{url,strategies:["html_fallback"]});
 const fixture=fixtures[key],stock=ticketSupplementUrl(source);
 test(`${slug}: audited ordinary stock is available, not a global sellout or low-price guess`,()=>{
  const observation=observeTicketSupplement(fixture,source,stock);
  assert.equal(observation.status,'available',observation.warning);assert.equal(observation.warning,undefined);
  assert.ok(observation.excerpt.includes('2027'));
  const candidate=extractFestivalCandidate(JSON.stringify({kind:TICKET_SUPPLEMENT,body:'<html></html>',ticket:{url:stock,html:fixture}}),source,at);
  assert.equal(candidate.ticketStatus,'available');assert.equal(candidate.ticketsUrl,ticketSupplementPurchaseUrl(source));
  assert.deepEqual(candidate.observedEditionYears,[2027]);assert.ok(candidate.evidence.every(e=>e.sourceUrl===stock));
 });
 for(const [name,change] of [
  ['old edition',f=>f.replaceAll('2027','2026')],
  ['block page',()=>'<html><title>Access denied</title></html>'],
  ['missing schema',()=>key==='jera'?'{}':'<html><title>Tickets 2027</title><a>Buy</a></html>'],
 ])test(`${slug}: ${name} retains unknown/review, never invents availability`,()=>{
  const observation=observeTicketSupplement(change(fixture),source,stock);
  assert.equal(observation.status,undefined);assert.ok(observation.warning);
 });
 test(`${slug}: exact registry, source overrides and edition rollover`,()=>{
  for(const override of [{url:'https://foreign.test/'},{editionYear:2028},{fetchUrl:url},{followLinkPattern:'^/tickets/$'},{strategies:['manual_review']}])assert.equal(ticketSupplementUrl({...source,...override}),undefined);
  assert.equal(observeTicketSupplement(fixture,source,'https://foreign.test/tickets').status,undefined);
 });
 test(`${slug}: live pipeline fetches frozen secondary source without inherited authorization`,async()=>{
  const seen=[];
  const result=await fetchSource({...source,headers:{authorization:'synthetic-local-test'}},{maxAttempts:1,fetchImpl:async (target,init)=>{
   seen.push(String(target));if(target===stock)assert.equal(init.headers.authorization,undefined);
   return new Response(target===url?'<html></html>':fixture,{headers:{'content-type':target===stock&&key==='jera'?'text/javascript':'text/html'}});
  }});
  assert.deepEqual(seen,[url,stock]);assert.equal(result.attempts,2);
  const c=extractFestivalCandidate(await result.response.text(),source,at);assert.equal(c.ticketStatus,'available');
 });
 test(`${slug}: secondary HTTP/schema/redirect failures are errors, not healthy empty stock`,async()=>{
  for(const status of [403,429,503]){
   const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async target=>new Response('failure',{status:target===url?200:status,headers:{'content-type':'text/html'}})});assert.equal(r.response.status,status);
  }
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async target=>new Response(target===url?'<html/>':fixture,{headers:{'content-type':target===stock?'image/png':'text/html'}})}),/unexpected stock document/);
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async target=>{const r=new Response(target===url?'<html/>':fixture,{headers:{'content-type':'text/html'}});if(target===stock)Object.defineProperty(r,'url',{value:'https://foreign.test/'});return r;}}),/changed identity/);
 });
}
for(const key of ['pinkpop','eurockeennes']){
 const row=cases.find(c=>c[2]===key),source=parserSource(row[0],{url:row[1],strategies:['html_fallback']}),fixture=fixtures[key],url=ticketSupplementUrl(source);
 for(const [name,change] of [
  ['hidden cards',f=>f.replaceAll(key==='pinkpop'?'<article':'<a class="lkbill27','<'+(key==='pinkpop'?'article hidden':'a hidden class="lkbill27'))],
  ['hidden ancestor',f=>f.replace('<body>','<body><section hidden>').replace('</body>','</section></body>')],
  ['disabled card',f=>f.replaceAll(key==='pinkpop'?'<article':'<a class="lkbill27',key==='pinkpop'?'<article aria-disabled="true"':'<a aria-disabled="true" class="lkbill27')],
  ['missing enabled purchase control',f=>f.replaceAll(key==='pinkpop'?'www.ticketmaster.nl':'widget.weezevent.com','foreign.test')],
  ['soldout mixed with CTA',f=>key==='pinkpop'?f.replace('Regulier</h3>','Regulier</h3><span>Uitverkocht</span>'):f.replace('Disponible<br/>','Épuisé Disponible<br/>')],
  ['only accessories',f=>key==='pinkpop'?f.replaceAll('Regulier','VIP'):f.replace('FORFAIT <br/>4 JOURS','CAMPING')],
  ['duplicate ordinary product',f=>key==='pinkpop'?f.replace('</body>',f.match(/<article[^]*?<\/article>/)[0]+'</body>'):f.replace('</body>',f.match(/<a class="lkbill27 dispolimite"[^]*?<\/a>/)[0]+'</body>')],
 ])test(`${key}: ${name} fails closed`,()=>{const o=observeTicketSupplement(change(fixture),source,url);assert.equal(o.status,undefined,o.excerpt);assert.ok(o.warning);});
 test(`${key}: minified DOM keeps original stock word boundaries`,()=>assert.equal(observeTicketSupplement(fixture.replace(/>\s+</g,'><'),source,url).status,'available'));
}
const trees=parserSource('2000trees',{url:cases[0][1],strategies:['html_fallback']}),treesUrl=ticketSupplementUrl(trees);
for(const [name,change] of [
 ['child/accessory stock only',e=>{e.offers=e.offers.filter(o=>/Parking|Child|Campervan/.test(o.name));}],
 ['unavailable ordinary admissions',e=>{e.offers.forEach(o=>{if(!/Parking|Child|Campervan/.test(o.name))o.availability='https://schema.org/SoldOut';});}],
 ['foreign offer destination',e=>{e.offers.forEach(o=>o.url='https://foreign.test/');}],
 ['cancelled festival',e=>{e.eventStatus='https://schema.org/EventCancelled';}],
 ['unknown stock enum',e=>{e.offers.forEach(o=>o.availability='https://schema.org/PreOrder');}],
])test(`2000trees: ${name} is not an available regular pass`,()=>{
 let f=fixtures['2000trees'];const match=f.match(/<script type="application\/ld\+json">([^]*?)<\/script>/),data=JSON.parse(match[1]);change(data['@graph'][0]);f=f.replace(match[1],JSON.stringify(data));const o=observeTicketSupplement(f,trees,treesUrl);assert.equal(o.status,undefined);assert.ok(o.warning);
});
test('2000trees: disabled shop control cannot be rescued by LD+JSON',()=>assert.equal(observeTicketSupplement(fixtures['2000trees'].replace('<a ','<a aria-disabled="true" '),trees,treesUrl).status,undefined));
const jera=parserSource('jera-on-air',{url:cases[3][1],strategies:['html_fallback']}),jeraUrl=ticketSupplementUrl(jera);
for(const [name,change] of [
 ['camping product',p=>{p.title=p.title.replace('Weekend','Camping');p.handle=p.handle.replace('weekend','camping');}],
 ['soldout weekend only',p=>{p.available=false;p.variants[0].available=false;}],
 ['conflicting product/variant',p=>{p.variants[0].available=false;}],
 ['foreign vendor',p=>{p.vendor='Another Event';}],
 ['subscription instead of admission',p=>{p.variants[0].requires_selling_plan=true;}],
 ['ambiguous duplicate variant',p=>{p.variants.push({...p.variants[0]});}],
 ['unexpected currency/price schema',p=>{p.price='25000';}],
])test(`Jera: ${name} remains review-required`,()=>{const p=JSON.parse(fixtures.jera);change(p);const o=observeTicketSupplement(JSON.stringify(p),jera,jeraUrl);assert.equal(o.status,undefined);assert.ok(o.warning);});
