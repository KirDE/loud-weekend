import { z } from "zod";
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
const timestamps = z.object({
  sale: z.iso.datetime({ offset: true }),
  rate: z.iso.datetime({ offset: true }),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
});

export function observeRfpStock(body: string, year: number, primary?: Partial<Pick<FestivalCandidate,"startDate"|"endDate"|"observedEditionYears">>): TicketObservation {
  const fail = (): TicketObservation => ({ excerpt: "", warning: "Official rock-for-people ticket source requires review: ordinary current sale/rate identity, stock or primary edition changed" });
  let data; try { data = JSON.parse(body); } catch { return fail(); }
  const sale = data?.sales?.["579901"], schedule = sale?.schedule, deal = sale?.deals?.["3633368"], counts = deal?.counts;
  // Existing official primary proves the rolling announcement year, not exact
  // dates. Do not invent dates or weaken its additive artist/provider guards.
  if (primary?.observedEditionYears?.length !== 1 || primary.observedEditionYears[0] !== year
    || data?.status !== 200 || data.production !== true || !sale || sale.id !== 579901 || sale.state !== "ACTIVE" || sale.currency !== "CZK" || sale.precisionCents !== 100
    || sale.url !== "https://goout.net/cs/listky/rock-for-people-2027/bvcmb/" || sale.eventName !== `Rock for People ${year}` || sale.scheduleId !== 9532556
    || sale.saleType !== "REGULAR" || sale.season !== false || sale.voucher !== false || sale.promo !== false || sale.donation !== false || sale.passCodeProtected !== false || sale.promoCodeProtected !== false
    || !Number.isSafeInteger(sale.ticketsLimit) || sale.ticketsLimit < 1
    || schedule?.id !== 9532556 || schedule.eventId !== 3395438 || schedule.cancelled !== false || schedule.state !== "APPROVED"
    || deal?.id !== 3633368 || deal.name !== "4 dny" || deal.active !== true || deal.hidden !== false || deal.hiddenDesk !== false || deal.onlyPrint !== false
    || deal.namedTickets !== false || deal.ticketNameSource !== "WITHOUT_NAME" || deal.joinedTickets !== false || deal.preOwnedTicketsRequired !== false || deal.unlimited !== false
    || typeof deal.isLastTickets !== "boolean"
    || !Number.isSafeInteger(deal.priceCents) || deal.priceCents <= 0
    || !Number.isSafeInteger(counts?.ticketsMinimum) || counts.ticketsMinimum < 0 || counts.ticketsMinimum > 1
    || !Number.isSafeInteger(counts.ticketsLimit) || counts.ticketsLimit < 1 || !Number.isSafeInteger(counts.ticketsAvailable) || counts.ticketsAvailable < 1) return fail();
  const clock = timestamps.safeParse({ sale: sale.startISO8601, rate: deal.start, start: schedule.startISO8601, end: schedule.endISO8601 });
  if (!clock.success) return fail();
  const { sale: saleAt, rate: rateAt, start, end } = clock.data;
  const startDay = start.slice(0, 10), endDay = end.slice(0, 10);
  const now = Date.now(), startsAt = Date.parse(start), endsAt = Date.parse(end);
  if (!startDay.startsWith(`${year}-`) || !endDay.startsWith(`${year}-`)
    || Date.parse(endDay) - Date.parse(startDay) !== 3 * 86_400_000 || startsAt >= endsAt || endsAt <= now
    || Date.parse(saleAt) > now || Date.parse(rateAt) > now || Date.parse(rateAt) >= startsAt || Date.parse(saleAt) > Date.parse(rateAt)
    || primary.startDate !== undefined && primary.startDate !== startDay
    || primary.endDate !== undefined && primary.endDate !== endDay) return fail();
  // ticketsAvailable is capped by per-order limits, not festival capacity.
  // Never label low/sold_out based on this count or a restricted sibling rate.
  return { status: "available", ticketsUrl: RFP_PURCHASE, excerpt: `Rock for People ${primary.observedEditionYears[0]}; ${startDay}–${endDay}; ordinary 4 dny; GoOut sale579901/rate3633368; active/public; CZK ${deal.priceCents/100}; unrestricted single-ticket inventory positive (per-order capped), not total remaining capacity` };
}
