import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ticketProducerPublication} from './support/ticket-producer-publication.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {RESURRECTION_CONFIG,RESURRECTION_SHOP,RESURRECTION_PRODUCTS} from '../lib/ingestion/resurrection-ticket-stock.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=(name:string)=>readFile(new URL('./fixtures/ticket-status/'+name,import.meta.url),'utf8');
const source=parserSource('resurrection-fest',{url:'https://www.resurrectionfest.es/',strategies:['html_fallback']});
ticketProducerPublication({slug:source.festivalSlug,forbiddenCandidates:c=>[{...c,lineup:['Synthetic Unreviewed Performer']},{...c,startDate:'2027-06-29'},{...c,ticketSupplement:{...c.ticketSupplement!,scope:undefined}},{...c,ticketSupplement:{...c.ticketSupplement!,scope:{namespace:'other-sale',productId:c.ticketSupplement!.scope!.productId}}}],refusalPattern:/cannot bypass source artist or date review|matching persisted official ticket evidence/,produce:async archived=>{
 const pages=new Map([[source.url,await fixture('resurrection-primary.html')],[RESURRECTION_CONFIG,await fixture('resurrection-public-config.json')],[RESURRECTION_SHOP,await fixture('resurrection-public-shop.json')],[RESURRECTION_PRODUCTS,await fixture('resurrection-public-products.json')]]);
 // Keep valid transport while independently checking the primary edition anchor;
 // extraction must preserve its old-year warning, despite current API stock.
 if(archived)pages.set(source.url,pages.get(source.url)!.replaceAll('2027','2026'));
 const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async target=>{
  assert.ok(pages.has(String(target)),'unexpected endpoint: '+target);
  return new Response(pages.get(String(target)),{headers:{'content-type':target===source.url?'text/html':'application/json'}});
 }});
 return extractFestivalCandidate(await fetched.response.text(),source,'2026-11-22T12:38:00Z');
}});
