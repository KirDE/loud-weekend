import { heavyPurchaseUrl, heavyStockUrl, heavyWidgetApi, type HeavyProof } from "./heavy-ticket-proof.ts";
import { load } from "cheerio";
import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
export const HEAVY_STOCK_DOCUMENTS = "heavy-public-initial-render-v1";
const text = (s: string) => s.replace(/\s+/g," ").trim();

/** Validate the public initial-render action before forwarding its unchanged
 * provider-issued token. This never constructs a token or selects a ticket. */
export function heavyRenderAction(data: any, proof: HeavyProof): { token: string; meta: { widget: string; eventId: number; name: string; status: string; startDate: string; currency: string } } {
  const fail = () => { throw new Error("Heavy public initial-render contract or event identity changed"); };
  if (data?.widget_key !== proof.widgetId || !Array.isArray(data.widget_events) || data.widget_events.length > 10) return fail();
  const widgets = data.widget_events.filter((w: any) => w?.widget_event_key === proof.widgetId);
  const event = widgets[0]?.event;
  if (widgets.length !== 1 || event?.id !== proof.eventId || event.name !== proof.eventName || event.status !== "published"
    || event.publication_status !== "published" || event.time_status !== "upcoming" || event.currency !== "EUR"
    || event.start_date !== proof.eventStart || event.sale_start_date !== null || event.sale_end_date !== null) return fail();
  const step = data.first_step, actions = step?.data?.actions;
  if (step?.slug !== "4-redirect" || step.is_final !== true || !Array.isArray(actions) || actions.length !== 1 || actions[0]?.action !== "form"
    || !Array.isArray(actions[0].args) || actions[0].args.length !== 1) return fail();
  const action = actions[0].args[0], q = action?.query;
  if (action?.url !== "https://www.weezevent.com/widget_billeterie.php" || !q || Object.keys(q).sort().join() !== "color_primary,id_evenement,locale,widget_key"
    || String(q.id_evenement) !== String(proof.eventId) || q.widget_key !== proof.widgetId || q.locale !== "en_GB" || q.color_primary !== "000000"
    || !action.parameters || Object.keys(action.parameters).join() !== "token") return fail();
  const token = action.parameters.token;
  if (typeof token !== "string" || token.length > 5000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return fail();
  let claims; try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return fail(); }
  // HTTPS API is the issuer/trust boundary. Never alter/sign the token. Claims
  // only bind this anonymous public render to the reviewed event and no inputs.
  const keys = ["iat","nbf","exp","iss","sub","rank","access","event_id","widget_key","widget_data"].sort().join();
  if (Object.keys(claims).sort().join() !== keys || claims.event_id !== proof.eventId || claims.widget_key !== proof.widgetId
    || claims.rank !== 1 || claims.access !== true || !claims.widget_data || typeof claims.widget_data !== "object" || Array.isArray(claims.widget_data) || Object.keys(claims.widget_data).length
    || !Number.isFinite(claims.exp) || !Number.isFinite(claims.nbf) || !Number.isFinite(claims.iat)
    || claims.exp <= Date.now()/1000 || claims.nbf > Date.now()/1000 + 5 || claims.iat > Date.now()/1000 + 5) return fail();
  return { token, meta: { widget: proof.widgetId, eventId: event.id, name: event.name, status: event.status, startDate: event.start_date, currency: event.currency } };
}

/** Reduce before persistence: keep actual provider DOM, not form/session/token,
 * customer or unrelated-category data. Preserve visibility and disabled state. */
export function reduceHeavyStockDocument(body: string, proof: HeavyProof): string {
  const $ = load(body), table = $(`#ticket_table_${proof.rateId}`), dayHeader = $(`.billetterie_tb_titre_categorie[data-id='${proof.categoryId}']`), standardHeader = $(`.billetterie_tb_titre_sous_categorie[data-id='${proof.subcategoryId}']`);
  if (table.length !== 1 || dayHeader.length !== 1 || standardHeader.length !== 1) throw new Error("Heavy ordinary stock table/category missing or duplicated");
  const blocked = "[hidden],[inert],[aria-hidden='true'],[disabled],[aria-disabled='true'],.disabled,.hidden,.is--hidden,.d-none";
  for (const el of [table,dayHeader,standardHeader]) {
    if (el.is(blocked) || el.parents(blocked).length || el.add(el.parents()).toArray().some(e => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style") ?? "")))
      throw new Error("Heavy ordinary stock table/category is hidden");
  }
  const nodes = [dayHeader.clone(),standardHeader.clone(),table.clone()];
  const allowed = new Set(["id","class","data-id","data-value","data-ticket_id","data-prix","data-prix-affiche","name","value","disabled","hidden","inert","aria-disabled","aria-hidden","selected","style"]);
  for (const root of nodes) {
    root.find("script,style,input,form,iframe,template,noscript,a,img,svg").remove();
    for (const e of root.find("*").add(root).toArray()) for (const attr of Object.keys("attribs" in e ? e.attribs : {})) if (!allowed.has(attr)) $(e).removeAttr(attr);
  }
  return nodes.map(n => $.html(n)).join("\n");
}

export function observeHeavyStock(body: string, proof: HeavyProof, dates?: Pick<FestivalCandidate,"startDate"|"endDate">): TicketObservation {
  const fail = (reason: string): TicketObservation => ({excerpt:"",warning:`Official heavy-weekend ticket source requires review: ${reason}`});
  let doc;try{doc=JSON.parse(body);}catch{return fail("public render envelope invalid");}
  const m=doc?.meta;
  if(doc?.kind!==HEAVY_STOCK_DOCUMENTS||doc.apiUrl!==heavyWidgetApi(proof)||doc.renderUrl!==heavyStockUrl(proof)||typeof doc.html!=="string"
    ||m?.widget!==proof.widgetId||m.eventId!==proof.eventId||m.name!==proof.eventName||m.status!=="published"||m.startDate!==proof.eventStart||m.currency!=="EUR"
    ||dates?.startDate!==proof.startDate||dates.endDate!==proof.endDate)return fail("current event/source/primary dates changed");
  let reduced; try { reduced = reduceHeavyStockDocument(doc.html, proof); } catch { return fail("ordinary rate/category hidden or ambiguous"); }
  const $=load(reduced);$("script,style,template,[hidden],[inert],[aria-hidden='true'],.hidden,.is--hidden,.d-none").remove();
  $("[style]").each((_,e)=>{if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style")??""))$(e).remove();});
  const category=$(`.billetterie_tb_titre_categorie[data-id='${proof.categoryId}']`),standard=$(`.billetterie_tb_titre_sous_categorie[data-id='${proof.subcategoryId}']`),table=$(`#ticket_table_${proof.rateId}`);
  if(category.length!==1||text(category.text())!=="3-DAY PASS"||standard.length!==1||text(standard.text())!=="STANDARD - SEATED / STANDING"||table.length!==1||!table.hasClass(`p_${proof.subcategoryId}`))
    return fail("ordinary three-day category or table missing/ambiguous");
  const row=table.find(`tr[data-id='${proof.rateId}']`),select=row.find(`select#quantite_${proof.rateId}[name='quantite_${proof.rateId}']`),price=row.find(".billetterie_tb_prix .globalize[data-value]");
  const blocked="[disabled],[aria-disabled='true'],[hidden],[inert],.disabled,.hidden,.is--hidden,.d-none";
  if(row.length!==1||text(row.find(".billetterie_tb_nom").text())!=="3-DAY PASS - STANDARD - FREE SEATING/STANDING"||select.length!==1||select.attr("data-ticket_id")!==String(proof.rateId)
    ||select.val()!=="0"||select.find("option[value='1']").length!==1||select.find("option[value='1']").is("[disabled],[hidden],[aria-disabled='true']")||[table,row,select].some(e=>e.is(blocked)||e.parents(blocked).length)
    ||price.length!==1||!/^\d+(?:\.\d+)?$/.test(price.attr("data-value")??"")||!Number.isFinite(Number(price.attr("data-value")))||Number(price.attr("data-value"))<=0
    ||select.attr("data-prix")!==price.attr("data-value")||select.attr("data-prix-affiche")!==price.attr("data-value")
    ||!/^€\d+(?:\.\d{2})?$/.test(text(price.text()))||Number(text(price.text()).slice(1))!==Number(price.attr("data-value"))
    ||/sold\s*out|unavailable|closed|complet|épuisé/i.test(text(row.text())))return fail("ordinary unrestricted rate stock/quantity/price unavailable or conflicting");
  return{status:"available",ticketsUrl:heavyPurchaseUrl(proof),excerpt:`${proof.eventName}; ordinary 3-DAY PASS STANDARD; event ${proof.eventId}/rate ${proof.rateId}; EUR ${price.attr("data-value")}; public initial render has enabled unselected quantity with option1; no ticket selected or reserved`};
}
