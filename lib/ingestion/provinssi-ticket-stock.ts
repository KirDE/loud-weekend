import type { ProvinssiStockDates } from "./festival-stock-dates.ts";
import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
export const PROVINSSI_SALE = "f20f4130e7bd49b99eeb38ad7236ccd9";
export const PROVINSSI_EVENT = "a406b7bdc0d74330bbb7a19e57766d96";
export const PROVINSSI_PRODUCT = "5fb581dd9f104d0298c11bf2f38e5b11";
const API = "https://shopping-api.paylogic.com";
export const PROVINSSI_SALE_API = `${API}/sales/${PROVINSSI_SALE}`;
export const PROVINSSI_STOCK = API + "/storefront?" + new URLSearchParams({event:`${API}/events/${PROVINSSI_EVENT}`});
export const PROVINSSI_PURCHASE = "https://provinssi.fi/en/tickets-2027";
export const PROVINSSI_SCOPE = {namespace:PROVINSSI_SALE,productId:PROVINSSI_PRODUCT};
export const PROVINSSI_DOCUMENTS = "provinssi-public-ordinary-stock-v1";
const productUrl = `${API}/products/${PROVINSSI_PRODUCT}`;
const pick=(v:any,keys:string[])=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
const title=(v:any)=>({en:v?.en,fi:v?.fi});
const period=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))&&Date.parse(a)<=Date.now()&&Date.parse(b)>Date.now();
/** API-issued anonymous storefront token is forwarded unchanged only to the
 * reviewed GET, never sign-in, customer, order, cart, voucher or reservation. */
export async function fetchProvinssiStock(reviewed: ProvinssiStockDates, fetchImpl:typeof fetch=fetch):Promise<{html:string;attempts:number}>{
  let attempts=0;
  const get=async(url:string,token?:string)=>{
    attempts++;
    const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(20_000),headers:{accept:"application/hal+json","user-agent":"LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)",...(token?{authorization:`Bearer ${token}`}:{})}});
    if(!response.ok||response.url&&response.url!==url||!/^application\/(?:hal\+)?json\b/i.test(response.headers.get("content-type")??""))throw new Error("Provinssi public metadata acquisition failed");
    const reader=response.body?.getReader();if(!reader)throw new Error("Provinssi public body missing");let bytes=0;const chunks:Uint8Array[]=[];
    try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>2_000_000)throw new Error("Provinssi public body exceeds limit");chunks.push(p.value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  try{
    const sale=await get(PROVINSSI_SALE_API),event=sale?._embedded?.["shop:event"],token=sale?.jwt_token;
    if(sale?.uid!==PROVINSSI_SALE||sale.event_uid!==PROVINSSI_EVENT||sale.state!=="Published"||sale.requires_approval!==false||sale.queue_enabled!==false
      ||event?.uid!==PROVINSSI_EVENT||event.title?.en!==reviewed.eventName||!period(sale.start_date,sale.end_date)
      ||typeof token!=="string"||token.length>8000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error("Provinssi public current sale or anonymous read contract changed");
    const store=await get(PROVINSSI_STOCK,token);
    return{attempts,html:JSON.stringify(reduceProvinssiStock(sale,store))};
  }catch{throw Object.assign(new Error("Provinssi public ordinary inventory acquisition failed; no customer/cart/reservation attempted"),{attempts});}
}
/** Keep only public source/ordinary product/category stock. No JWT, session,
 * customer, legal, organizer, payment or unrelated products reach evidence. */
export function reduceProvinssiStock(sale:any,store:any){
  const products=Array.isArray(store?._embedded?.["shop:product"])?store._embedded["shop:product"].filter((p:any)=>p?.uid===PROVINSSI_PRODUCT):[];
  const parent=Array.isArray(store?.categories)?store.categories.filter((c:any)=>c?.uid==="51df16042ca2429097b41a43feb2e105"):[];
  const categories=parent.map((p:any)=>({uid:p.uid,name:title(p.name),categories:Array.isArray(p.categories)?p.categories.filter((c:any)=>c?.uid==="ecb7c54a27d14cf787d4b7fd1953b01e").map((c:any)=>({uid:c.uid,name:title(c.name),items:Array.isArray(c.items)?c.items.filter((i:any)=>i?.product===productUrl).map((i:any)=>({...pick(i,["product","min_quantity","max_quantity","is_sold_out","combo","unit_price","total","sections","available_in_secondary_sale"]),price_breakdown:pick(i.price_breakdown,["unit_price_including_service_costs","unit_price_excluding_service_costs","unit_price_service_costs"])})):[]})):[]}));
  const e=store?._embedded?.["shop:event"];
  return{kind:PROVINSSI_DOCUMENTS,scope:PROVINSSI_SCOPE,saleApi:PROVINSSI_SALE_API,stockApi:PROVINSSI_STOCK,
    sale:pick(sale,["uid","event_uid","state","requires_approval","queue_enabled","start_date","end_date"]),
    store:{is_sold_out:store?.is_sold_out,uses_vouchers:store?.uses_vouchers,self:store?._links?.self?.href,event:{...pick(e,["uid","event_start","event_end","sold_out"]),title:title(e?.title)},
      products:products.map((p:any)=>({...pick(p,["uid","price","type","sale_start","sale_end","min_per_order","max_per_order","separately_saleable","parents","combo","personalization_required","requires_membership","provides_membership"]),name:title(p.name),self:p._links?.self?.href,event:p._links?.["shop:event"]?.href})),categories}};
}
export function observeProvinssiStock(body:string,reviewed: ProvinssiStockDates,primary?:Pick<FestivalCandidate,"startDate"|"endDate">):TicketObservation{
  const fail=():TicketObservation=>({excerpt:"",warning:"Official provinssi ticket source requires review: current ordinary public sale/product stock incomplete or conflicting"});
  let d;try{d=JSON.parse(body);}catch{return fail();}const s=d?.sale,st=d?.store,e=st?.event,p=st?.products?.[0],parent=st?.categories?.[0],cat=parent?.categories?.[0],i=cat?.items?.[0];
  const one=(min:any,max:any)=>(min===null||Number.isSafeInteger(min)&&min>=0&&min<=1)&&(max===null||Number.isSafeInteger(max)&&max>=1);
  const amount=(v:any)=>v?.currency==="EUR"&&typeof v.amount==="string"&&/^\d+\.\d{2}$/.test(v.amount)&&Number(v.amount)>0?Number(v.amount):NaN;
  let selfSale;try{const u=new URL(st?.self);if(u.origin!==API||u.pathname!=="/storefront"||[...u.searchParams.keys()].join()!=="sale")return fail();selfSale=u.searchParams.get("sale");}catch{return fail();}
  if(d?.kind!==PROVINSSI_DOCUMENTS||d.scope?.namespace!==PROVINSSI_SCOPE.namespace||d.scope?.productId!==PROVINSSI_PRODUCT||Object.keys(d.scope??{}).length!==2||d.saleApi!==PROVINSSI_SALE_API||d.stockApi!==PROVINSSI_STOCK||selfSale!==PROVINSSI_SALE_API
    ||primary?.startDate!==reviewed.startDate||primary.endDate!==reviewed.endDate||s?.uid!==PROVINSSI_SALE||s.event_uid!==PROVINSSI_EVENT||s.state!=="Published"||s.requires_approval!==false||s.queue_enabled!==false||!period(s.start_date,s.end_date)
    ||st?.is_sold_out!==false||st.uses_vouchers!==false||e?.uid!==PROVINSSI_EVENT||e.title?.en!==reviewed.eventName||e.title.fi!==reviewed.eventName||e.sold_out!==false||e.event_start!==reviewed.eventStart||e.event_end!==reviewed.eventEnd
    ||st.products?.length!==1||p?.uid!==PROVINSSI_PRODUCT||p.self!==productUrl||p.event!==`${API}/events/${PROVINSSI_EVENT}`||p.name?.en!=="3 DAYS"||p.name.fi!=="3 PÄIVÄÄ"||p.type!=="entrance"||!period(p.sale_start,p.sale_end)
    ||p.separately_saleable!==true||p.personalization_required!==false||p.requires_membership!==false||p.provides_membership!==false||p.parents!==null||p.combo!==null||!one(p.min_per_order,p.max_per_order)
    ||st.categories?.length!==1||parent?.uid!=="51df16042ca2429097b41a43feb2e105"||parent.name?.en!==reviewed.categoryName||parent.categories?.length!==1||cat?.uid!=="ecb7c54a27d14cf787d4b7fd1953b01e"||cat.name?.en!=="THREE DAYS"||cat.items?.length!==1
    ||i?.product!==productUrl||i.is_sold_out!==false||i.available_in_secondary_sale!==false||!one(i.min_quantity,i.max_quantity)||!Array.isArray(i.combo)||i.combo.length||!Array.isArray(i.sections)||i.sections.length
    ||!Number.isFinite(amount(p.price))||!Number.isFinite(amount(i.unit_price))||amount(i.total)!==amount(i.unit_price)||amount(i.price_breakdown?.unit_price_including_service_costs)!==amount(i.unit_price)||amount(i.price_breakdown?.unit_price_excluding_service_costs)!==amount(p.price)
    ||!Number.isFinite(amount(i.price_breakdown?.unit_price_service_costs))||Math.abs(amount(p.price)+amount(i.price_breakdown?.unit_price_service_costs)-amount(i.unit_price))>.011)return fail();
  return{status:"available",ticketsUrl:PROVINSSI_PURCHASE,excerpt:`${reviewed.eventName}; ${reviewed.startDate}–${reviewed.endDate}; ordinary 3 DAYS; namespace ${PROVINSSI_SCOPE.namespace}; product ${PROVINSSI_PRODUCT}; EUR ${i.unit_price.amount}; published current public sale, exact ordinary category is_sold_out=false and single-ticket order allowed; no ticket selected/reserved`};
}
