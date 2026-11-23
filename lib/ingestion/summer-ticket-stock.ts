import { load } from "cheerio";
import { z } from "zod";
import type { FestivalCandidate, FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
export const SUMMER_ORIGIN = "https://sklep.ebilet.pl";
export const SUMMER_EVENT = "602356450160803841";
export const SUMMER_EVENT_API = `${SUMMER_ORIGIN}/api/event/getevent/${SUMMER_EVENT}`;
export const SUMMER_TOKEN = `${SUMMER_ORIGIN}/home/token`;
export const SUMMER_STOCK = `${SUMMER_ORIGIN}/api/event/getpricezonestickettypeslimit`;
export const SUMMER_SECTOR_LIMIT = `${SUMMER_ORIGIN}/api/event/getislimitreachedfornotnumberedsectors?eid=${SUMMER_EVENT}`;
export const SUMMER_COUNTS = SUMMER_ORIGIN + "/api/event/getsectorfreeseatscount?" + new URLSearchParams({eid:SUMMER_EVENT,sids:'{"1:2:3":["1","3"]}',ec:"null",tid:"0"});
export const SUMMER_SCOPE = { namespace: SUMMER_EVENT, productId: "140247054:140247050" };
export const SUMMER_PURCHASE = "https://summerpunchfestival.pl/bilety";
export const SUMMER_DOCUMENTS = "summer-public-ordinary-stock-v1";
export const SUMMER_LIMIT_REQUEST = { ei: SUMMER_EVENT, pztt: [{pzi:140247054,tt:[140247050]}] };
const edition = 2027;
const eventName = `Summer Punch Festival ${edition} - Karnet 3 dniowy`;
export function isSummerStockSource(source: FestivalSource): boolean {
  return source.festivalSlug === "summer-punch" && source.url === "https://summerpunchfestival.pl/"
    && source.editionYear === edition && source.strategies.includes("official_markup");
}

const localTimestamp = z.iso.datetime({ local: true }).refine(value => !value.endsWith("Z"));
const eventClock = z.object({ sd: localTimestamp, ed: localTimestamp, ssd: localTimestamp, sed: localTimestamp });
const warsaw = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function readSummerDates(event: unknown) {
  const clock = eventClock.safeParse(event);
  if (!clock.success) return;
  const { sd, ed, ssd, sed } = clock.data;
  const startDate = sd.slice(0, 10), endDate = ed.slice(0, 10);
  const now = warsaw.format(new Date()).replace(" ", "T");
  if (!startDate.startsWith(`${edition}-`) || !endDate.startsWith(`${edition}-`)
    || Date.parse(endDate) - Date.parse(startDate) !== 2 * 86_400_000
    || ssd > now || sed <= now || ed < sed) return;
  return { startDate, endDate };
}
const pick = (value: any, fields: string[]) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k,value[k]]));
const business = (value: any) => ({t: value?.t === 0 ? 0 : 1, err: value?.err === null ? null : "public source error"});
const REVIEWED_PUBLIC_DISTRIBUTION = "65537-65538-65538";
const rateFields = ["id","pid","n","sc","k","v","na","ga","pwsc","scv","hl","po","ldmp","ip","gfpwsc","ida"];
/** Discard anonymous session/CSRF, organizer/customer/legal and unrelated rate
 * data before normalized evidence. IDs arrive as strings: never coerce 64-bit IDs. */
export function reduceSummerEvent(data: any) {
  const event = data?.e;
  const rates = Array.isArray(event?.tt) ? event.tt.filter((r:any)=>r?.id===140247050) : [];
  const zones = Array.isArray(event?.pz) ? event.pz.filter((z:any)=>z?.id===140247054) : [];
  return {...business(data),...pick(data,["acte","wts","hb"]),reviewedDistribution:data?.dk===REVIEWED_PUBLIC_DISTRIBUTION,e:{...pick(event,["id","t","sd","ed","ssd","sed","cu","hrs"]),
    tt:rates.map((r:any)=>pick(r,rateFields)),pz:zones.map((z:any)=>({...pick(z,["id","n"]),tt:Array.isArray(z.tt)?z.tt.filter((r:any)=>r?.id===140247050).map((r:any)=>pick(r,rateFields)):[]})),
    // Only emptiness matters; never retain private/opaque access-pool records.
    hasAccessPools:!Array.isArray(event?.ap)||event.ap.length!==0}};
}
async function bounded(response:Response,max=2_000_000){
  const reader=response.body?.getReader();if(!reader)throw new Error("Summer public stock body missing");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max)throw new Error("Summer public stock body exceeds limit");chunks.push(part.value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks).toString("utf8");
}
/** Anonymous CSRF pair is obtained and forwarded exactly as the public client
 * does. Read-only metadata POST has IDs only, never quantity/customer/cart data.
 * No browser dependency, auth/header reuse, signing, redirects or POST retry. */
export async function fetchSummerStock(fetchImpl:typeof fetch=fetch):Promise<{html:string;attempts:number}>{
  let attempts=0;const cookies=new Map<string,string>();
  const base={accept:"application/json","user-agent":"LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)"};
  const request=async(url:string,init:RequestInit={})=>{
    attempts++;
    const response=await fetchImpl(url,{...init,redirect:"error",signal:AbortSignal.timeout(20_000),headers:{...base,...(init.headers??{})}});
    if(!response.ok||response.url&&response.url!==url)throw new Error("Summer public metadata HTTP or source identity failed");
    const type=response.headers.get("content-type")??"";
    if(!(url===SUMMER_TOKEN?/^text\/html\b/i:/^application\/json\b/i).test(type))throw new Error("Summer public metadata media type changed");
    if(url===SUMMER_TOKEN){
      for(const set of response.headers.getSetCookie()){
        const pair=set.split(";",1)[0],i=pair.indexOf("="),name=pair.slice(0,i);
        if(name==="wdctx"||/^\.AspNetCore\.Antiforgery\.[A-Za-z0-9_-]+$/.test(name)){
          const value=pair.slice(i+1);if(i<1||!value||value.length>8000||/[\r\n;]/.test(value))throw new Error("Summer public CSRF cookie invalid");cookies.set(name,value);
        }
      }
    }
    return bounded(response,url===SUMMER_TOKEN?10000:2_000_000);
  };
  try{
    const metadata=JSON.parse(await request(SUMMER_EVENT_API));
    if(metadata?.t!==0||metadata.err!==null||metadata.acte!==true||metadata.wts!==0||metadata.hb!==false||metadata.dk!==REVIEWED_PUBLIC_DISTRIBUTION||metadata.e?.id!==SUMMER_EVENT||metadata.e.t!==eventName||!readSummerDates(metadata.e))throw new Error("Summer public event identity or open-sale contract changed");
    const tokenHtml=await request(SUMMER_TOKEN,{headers:{accept:"text/html"}}),$=load(tokenHtml),inputs=$("input[name='__RequestVerificationToken']");
    const token=inputs.attr("value");
    if(inputs.length!==1||!token||token.length>8000||/[\r\n]/.test(token)||!cookies.has("wdctx")||[...cookies.keys()].filter(k=>k.startsWith(".AspNetCore.Antiforgery.")).length!==1)throw new Error("Summer anonymous public CSRF schema changed");
    const limits=JSON.parse(await request(SUMMER_STOCK,{method:"POST",headers:{"content-type":"application/json","x-xsrf-token":token,cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; ")},body:JSON.stringify(SUMMER_LIMIT_REQUEST)}));
    const sectorLimit=JSON.parse(await request(SUMMER_SECTOR_LIMIT)),counts=JSON.parse(await request(SUMMER_COUNTS));
    const scopedLimits=Array.isArray(limits?.pzttl)?limits.pzttl.filter((z:any)=>z?.pzi===140247054).map((z:any)=>({pzi:z.pzi,ttl:pick(z.ttl,["140247050"])})):[];
    return{attempts,html:JSON.stringify({kind:SUMMER_DOCUMENTS,scope:SUMMER_SCOPE,eventApi:SUMMER_EVENT_API,stockApi:SUMMER_STOCK,sectorApi:SUMMER_SECTOR_LIMIT,countsApi:SUMMER_COUNTS,event:reduceSummerEvent(metadata),
      limits:{...business(limits),pzttl:scopedLimits},sectorLimit:{...business(sectorLimit),ilrfnns:pick(sectorLimit.ilrfnns,[SUMMER_EVENT])},counts:{...business(counts),sfc:pick(counts.sfc,[SUMMER_EVENT])}})};
  }catch{throw Object.assign(new Error("Summer public ordinary inventory acquisition failed; no cart/reservation attempted"),{attempts});}
}
export function observeSummerStock(body:string,primary?:Pick<FestivalCandidate,"startDate"|"endDate">):TicketObservation{
  const fail=():TicketObservation=>({excerpt:"",warning:"Official summer-punch ticket source requires review: current ordinary scoped public inventory incomplete or conflicting"});
  let d;try{d=JSON.parse(body);}catch{return fail();}const response=d?.event,e=response?.e,z=e?.pz?.[0],r=z?.tt?.[0],base=e?.tt?.[0],limits=d?.limits,sector=d?.sectorLimit,counts=d?.counts;
  const dates = readSummerDates(e);
  if(d?.kind!==SUMMER_DOCUMENTS||d.scope?.namespace!==SUMMER_SCOPE.namespace||d.scope?.productId!==SUMMER_SCOPE.productId||Object.keys(d.scope??{}).length!==2
    ||d.eventApi!==SUMMER_EVENT_API||d.stockApi!==SUMMER_STOCK||d.sectorApi!==SUMMER_SECTOR_LIMIT||d.countsApi!==SUMMER_COUNTS
    ||!dates||primary?.startDate!==dates.startDate||primary.endDate!==dates.endDate
    ||response?.t!==0||response.err!==null||response.acte!==true||response.wts!==0||response.hb!==false||response.reviewedDistribution!==true
    ||e?.id!==SUMMER_EVENT||e.t!==eventName||e.cu!==95||e.hrs!==false||e.hasAccessPools!==false
    ||e.tt?.length!==1||base?.id!==140247050||base.n!=="KARNET 3 DNIOWY"||base.v!==7||e.pz?.length!==1||z?.id!==140247054||z.n!=="ROUND #1"||z.tt?.length!==1
    ||r?.id!==140247050||r.pid!==19941643||r.n!=="KARNET 3 DNIOWY"||r.v!==7||r.sc!==1||r.k!==1||r.ida!==false||r.ip!==false||r.po!==0||r.hl!==true||r.gfpwsc!==null
    ||![r.ga,r.pwsc,r.scv].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0)||Math.abs(r.ga+r.scv-r.pwsc)>.011
    ||limits?.t!==0||limits.err!==null||limits.pzttl?.length!==1||limits.pzttl[0].pzi!==140247054||!Number.isSafeInteger(limits.pzttl[0].ttl?.["140247050"])||limits.pzttl[0].ttl["140247050"]<1
    ||sector?.t!==0||sector.err!==null||sector.ilrfnns?.[SUMMER_EVENT]!==false||counts?.t!==0||counts.err!==null||!Number.isSafeInteger(counts.sfc?.[SUMMER_EVENT])||counts.sfc[SUMMER_EVENT]<1)return fail();
  // Positive regular stock and overall sector capacity, never VIP/child stock.
  // Do not infer low or global sold-out from one price pool or API order caps.
  return{status:"available",ticketsUrl:SUMMER_PURCHASE,excerpt:`${eventName}; ${dates.startDate}–${dates.endDate}; ordinary KARNET 3 DNIOWY; namespace ${SUMMER_SCOPE.namespace}; product ${SUMMER_SCOPE.productId}; PLN ${r.pwsc}; public ordinary rate limit and ordinary sector capacity positive, sector limit not reached; no ticket selected/reserved`};
}
