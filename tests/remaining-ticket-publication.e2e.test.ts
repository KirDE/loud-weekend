import { withRemainingProof } from "../lib/ingestion/remaining-ticket-proof.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { ticketSupplementUrl } from "../lib/ingestion/ticket-supplements.ts";
import { parserSource } from "./support/parser-source.ts";
import type { ParserStrategy } from "../lib/ingestion/types.ts";
const fixture=(name:string)=>readFile(new URL("./fixtures/"+name,import.meta.url),"utf8");
for(const [slug,url,primary,stock,strategy] of [
 ["2000trees","https://2000trees.co.uk/","ticket-status/2000trees-primary.html","2000trees-ordinary-stock.html","official_markup"],
 ["pinkpop","https://www.pinkpop.nl/","official-markup/pinkpop-lineup-2027.html","pinkpop-ordinary-stock.html","official_markup"],
 ["eurockeennes","https://www.eurockeennes.fr/","ticket-status/eurockeennes-primary.html","eurockeennes-ordinary-stock.html","html_fallback"],
 ["jera-on-air","https://www.jeraonair.nl/en/info/","ticket-status/jera-primary.html","jera-ordinary-stock.json","official_markup"],
]) {
 const baseSource=parserSource(slug,{url,strategies:[strategy as ParserStrategy]});
 ticketProducerPublication({slug,produce:async (archived, db)=>{
  const source=await withRemainingProof(db, baseSource);
  const pages=new Map([[url,await fixture(primary)],[ticketSupplementUrl(source)!,await fixture("ticket-status/"+stock)]]);
  if(archived)for(const [url,body]of pages)pages.set(url,body.replaceAll("2027","2026"));
  const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async target=>{
   assert.ok(pages.has(String(target)),"unexpected source request: "+target);
   return new Response(pages.get(String(target)),{headers:{"content-type":String(target).endsWith(".js")?"text/javascript":"text/html"}});
  }});
  assert.equal(fetched.response.status,200);
  return extractFestivalCandidate(await fetched.response.text(),source,"2026-11-22T12:30:00Z");
 }});
}
