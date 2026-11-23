import { withAlcatrazProof } from "../lib/ingestion/alcatraz-ticket-proof.ts";
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ticketProducerPublication} from './support/ticket-producer-publication.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {ALCATRAZ_STOCK} from './fixtures/ticket-status/alcatraz-reviewed-proof.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=(name:string)=>readFile(new URL('./fixtures/'+name,import.meta.url),'utf8');
const baseSource=parserSource('alcatraz',{url:'https://www.alcatraz.be/',strategies:['json_ld_event','html_fallback']});
ticketProducerPublication({slug:'alcatraz',produce:async (archived, db)=>{
 const source=await withAlcatrazProof(db, baseSource);
 const pages=new Map([[source.url,await fixture('official-markup/alcatraz-current-banner.html')],[ALCATRAZ_STOCK,await fixture('ticket-status/alcatraz-public-stock.json')]]);
 if(archived)for(const[u,body]of pages)pages.set(u,body.replaceAll('2027','2026'));
 const result=await fetchSource(source,{maxAttempts:1,fetchImpl:async target=>{
  assert.ok(pages.has(String(target)),'unexpected request');const r=new Response(pages.get(String(target)),{headers:{'content-type':target===source.url?'text/html':'application/json'}});
  Object.defineProperty(r,'url',{value:target===source.url?'https://www.alcatraz.be/en/':ALCATRAZ_STOCK});return r;
 }});
 return extractFestivalCandidate(await result.response.text(),source,'2026-11-22T12:50:00Z');
}});
