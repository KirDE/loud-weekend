import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
export const RFP_STOCK = "https://goout.net/services/feeder/v3/sales?saleIds=579901&details=false&language=cs";
export const RFP_PURCHASE = "https://rockforpeople.cz/tickets/";
/** Public feeder includes legal/contact/payment data: project it locally before
 * normalized evidence, retaining only the reviewed public sale/rate contract. */
export function reduceRfpStockDocument(body: string): string {
  const data = JSON.parse(body), sale = data?.sales?.["579901"], deal = sale?.deals?.["3633368"];
  const pick = (value: any, fields: string[]) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
  const publicSale = pick(sale, ["id","startISO8601","url","currency","precisionCents","season","voucher","state","ticketsLimit","promo","scheduleId","eventName","saleType","passCodeProtected","promoCodeProtected","donation"]);
  publicSale.schedule = pick(sale?.schedule,["id","eventId","cancelled","startISO8601","endISO8601","state"]);
  publicSale.deals = { "3633368": { ...pick(deal,["id","name","start","hidden","hiddenDesk","active","namedTickets","ticketNameSource","joinedTickets","preOwnedTicketsRequired","unlimited","onlyPrint","isLastTickets","priceCents"]),
    counts: pick(deal?.counts,["ticketsMinimum","ticketsLimit","ticketsAvailable"]) } };
  return JSON.stringify({ status: data?.status, production: data?.production, sales: { "579901": publicSale } });
}
export function observeRfpStock(body: string, primary?: Partial<Pick<FestivalCandidate,"startDate"|"endDate"|"observedEditionYears">>): TicketObservation {
  const fail = (): TicketObservation => ({ excerpt: "", warning: "Official rock-for-people ticket source requires review: ordinary current sale/rate identity, stock or primary edition changed" });
  let data; try { data = JSON.parse(body); } catch { return fail(); }
  const sale = data?.sales?.["579901"], schedule = sale?.schedule, deal = sale?.deals?.["3633368"], counts = deal?.counts;
  // Existing official primary proves the rolling announcement year, not exact
  // dates. Do not invent dates or weaken its additive artist/provider guards.
  if (primary?.observedEditionYears?.length !== 1 || primary.observedEditionYears[0] !== 2027
    || primary.startDate !== undefined && primary.startDate !== "2027-06-02" || primary.endDate !== undefined && primary.endDate !== "2027-06-05"
    || data.status !== 200 || data.production !== true || !sale || sale.id !== 579901 || sale.state !== "ACTIVE" || sale.currency !== "CZK" || sale.precisionCents !== 100
    || sale.url !== "https://goout.net/cs/listky/rock-for-people-2027/bvcmb/" || sale.eventName !== "Rock for People 2027" || sale.scheduleId !== 9532556
    || sale.startISO8601 !== "2026-06-18T10:00:00+02:00" || Date.parse(sale.startISO8601) > Date.now()
    || sale.saleType !== "REGULAR" || sale.season !== false || sale.voucher !== false || sale.promo !== false || sale.donation !== false || sale.passCodeProtected !== false || sale.promoCodeProtected !== false
    || !Number.isSafeInteger(sale.ticketsLimit) || sale.ticketsLimit < 1
    || schedule?.id !== 9532556 || schedule.eventId !== 3395438 || schedule.cancelled !== false || schedule.state !== "APPROVED"
    || schedule.startISO8601 !== "2027-06-02T12:00:01+02:00" || schedule.endISO8601 !== "2027-06-05T23:59:00+02:00"
    || deal?.id !== 3633368 || deal.name !== "4 dny" || deal.active !== true || deal.hidden !== false || deal.hiddenDesk !== false || deal.onlyPrint !== false
    || deal.namedTickets !== false || deal.ticketNameSource !== "WITHOUT_NAME" || deal.joinedTickets !== false || deal.preOwnedTicketsRequired !== false || deal.unlimited !== false
    || deal.start !== "2026-08-05T20:49:00+02:00" || Date.parse(deal.start) > Date.now() || typeof deal.isLastTickets !== "boolean"
    || !Number.isSafeInteger(deal.priceCents) || deal.priceCents <= 0
    || !Number.isSafeInteger(counts?.ticketsMinimum) || counts.ticketsMinimum < 0 || counts.ticketsMinimum > 1
    || !Number.isSafeInteger(counts.ticketsLimit) || counts.ticketsLimit < 1 || !Number.isSafeInteger(counts.ticketsAvailable) || counts.ticketsAvailable < 1) return fail();
  // ticketsAvailable is capped by per-order limits, not festival capacity.
  // Never label low/sold_out based on this count or a restricted sibling rate.
  return { status: "available", ticketsUrl: RFP_PURCHASE, excerpt: `Rock for People 2027; 2–5 June; ordinary 4 dny; GoOut sale579901/rate3633368; active/public; CZK ${deal.priceCents/100}; unrestricted single-ticket inventory positive (per-order capped), not total remaining capacity` };
}
