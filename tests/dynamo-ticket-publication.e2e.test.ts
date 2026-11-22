import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ticketProducerPublication } from "./support/ticket-producer-publication.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
const root="https://dynamo-metalfest.nl", articleUrl=root+"/early-bird-tickets-are-live/";
const source=parserSource("dynamo-metal-fest",{url:root+"/first-names-dmf-27/"});
const fixture=(p:string)=>readFile(new URL("./fixtures/official-markup/"+p,import.meta.url),"utf8");
ticketProducerPublication({slug:source.festivalSlug,produce:async archived=>{
 const primary=await fixture("dynamo-first-names-2027.html"), article=await fixture("dynamo-early-bird-2027.html");
 const captured=JSON.parse(await fixture("dynamo-live-sale-2027.json"));
 const docs:Array<{url:string;title:string;heading:string;event:unknown}>=JSON.parse(await fixture("dynamo-current-discovery-2027.json"));
 // Anonymous shop authentication is synthetic, never a real token in output.
 captured.sale.jwt_token="anonymous-test-only";
 if(archived) captured.storefront._embedded["shop:event"].title.en="Dynamo Metalfest 2026";
 const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async(target,options)=>{
  const url=String(target);
  if(url===source.url)return new Response(primary+`<a href="${root}/line-up/">Line-up</a>`);
  if(url===root+"/line-up/")return new Response(`<link rel="canonical" href="${url}"><main><h1>LINE-UP</h1>${docs.map(d=>`<a href="${d.url}"><div data-widget_type="theme-post-title.default"><h2>${d.heading}</h2></div></a>`).join("")}</main>`);
  const band=docs.find(d=>d.url===url);
  if(band)return new Response(`<title>${band.title.replaceAll("&","&amp;")}</title><link rel="canonical" href="${url}"><div data-elementor-type="single-post"><h1>${band.heading} op Dynamo Metalfest in Eindhoven Nederland</h1><h2>${band.heading}</h2><a href="${root}/line-up/">TERUG NAAR LINE-UP 2027</a></div><footer></footer><script class="dmf-schema">${JSON.stringify(band.event)}</script>`);
  if(url===root+"/nieuws/")return new Response(`<h1>NIEUWS</h1><a href="${articleUrl}">Early Bird Tickets Are Live!</a>`);
  if(url===articleUrl)return new Response(article);
  if(url===captured.sale._links.self.href)return Response.json(captured.sale);
  if(url.startsWith("https://shopping-api.paylogic.com/storefront?")){
   assert.equal(new Headers(options?.headers).get("authorization"),"Bearer anonymous-test-only");
   assert.equal(options?.redirect,"error");return Response.json(captured.storefront);
  }
  assert.fail("Unexpected source request");
 }});
 const body=await fetched.response.text();
 assert.ok(!body.includes("anonymous-test-only"));assert.ok(!body.includes("jwt_token"));
 return extractFestivalCandidate(body,source,captured.storefront.generated_on);
}});
