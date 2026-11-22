import {readFileSync} from "node:fs";
import {SUMMER_EVENT,SUMMER_EVENT_API,SUMMER_TOKEN,SUMMER_STOCK,SUMMER_SECTOR_LIMIT,SUMMER_COUNTS} from "../../lib/ingestion/summer-ticket-stock.ts";
export const summerEvent=JSON.parse(readFileSync(new URL("../fixtures/ticket-status/summer-public-event.json",import.meta.url),"utf8"));
export const summerLimits={t:0,err:null,pzttl:[{pzi:140247054,ttl:{"140247050":1824}}]};
export const summerSectorLimit={t:0,err:null,ilrfnns:{[SUMMER_EVENT]:false}};
export const summerCounts={t:0,err:null,sfc:{[SUMMER_EVENT]:2048}};
/** All tokens/cookies below synthetic, never captured anonymous provider data. */
export function summerStockResponse(url:string|URL|Request):Response|undefined{
  if(String(url)===SUMMER_EVENT_API)return Response.json(summerEvent);
  if(String(url)===SUMMER_TOKEN){const r=new Response('<input name="__RequestVerificationToken" type="hidden" value="synthetic-public-token-only">',{headers:{"content-type":"text/html"}});r.headers.append("set-cookie",".AspNetCore.Antiforgery.Test=synthetic-csrf-cookie; Secure; HttpOnly; Path=/");r.headers.append("set-cookie","wdctx=synthetic-public-cookie; Secure; Path=/");return r;}
  if(String(url)===SUMMER_STOCK)return Response.json(summerLimits);
  if(String(url)===SUMMER_SECTOR_LIMIT)return Response.json(summerSectorLimit);
  if(String(url)===SUMMER_COUNTS)return Response.json(summerCounts);
}
