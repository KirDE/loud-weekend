import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

export const ALCATRAZ_SHOP = "a22e0ce7-7657-4601-addc-13d7d0cac701";
export const ALCATRAZ_STOCK = `https://shop.api.openticket.tech/${ALCATRAZ_SHOP}/data`;
export const ALCATRAZ_PURCHASE = `https://shop.weeztix.com/${ALCATRAZ_SHOP}`;
const eventId = "69108611-833e-49a3-8170-71f3011c23aa";
const passId = "b97eba3b-553a-43c4-a419-db2dc62d71b6";

/** Only the observed same-site root→English landing redirect is trusted. */
export function alcatrazPrimaryUrl(configured: string, actual: string): boolean {
  return actual === configured || configured === "https://www.alcatraz.be/" && actual === "https://www.alcatraz.be/en/";
}

export function observeAlcatrazStock(body: string, dates?: Pick<FestivalCandidate, "startDate" | "endDate"> & { fetchedAt?: string }): TicketObservation {
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official alcatraz ticket source requires review: ${reason}` });
  let data; try { data = JSON.parse(body); } catch { return fail("invalid public shop JSON"); }
  if (!dates?.fetchedAt || !Number.isFinite(Date.parse(dates.fetchedAt)) || dates.startDate !== "2027-08-05" || dates.endDate !== "2027-08-08")
    return fail("current primary festival dates/check time absent");
  if (!data || !Array.isArray(data.shops) || data.shops.length !== 1 || data.shops[0]?.guid !== ALCATRAZ_SHOP
    || data.shops[0].name !== "Alcatraz Open Air 2027" || data.shops[0].currency !== "EUR" || data.shops[0].event_selection !== "auto"
    || !Array.isArray(data.events) || data.events.length > 30 || !data.tickets || typeof data.tickets !== "object" || Array.isArray(data.tickets)
    || Object.keys(data.tickets).length > 300 || !Array.isArray(data.pivots?.["shops-tickets"])) return fail("shop/event/ticket schema or current identity changed");
  const events = data.events.filter((e: any) => e?.guid === eventId || e?.name === "Alcatraz Open Air 2027");
  if (events.length !== 1 || events[0].guid !== eventId || events[0].name !== "Alcatraz Open Air 2027" || events[0].status !== "normal"
    || events[0].currency !== "EUR" || events[0].start !== "2027-08-05T09:00:00+02:00" || events[0].end !== "2027-08-09T01:30:00+02:00")
    return fail("ordinary festival event edition/date/status changed");
  const passes = Object.entries(data.tickets).filter(([id, t]: [string, any]) => id === passId || t?.guid === passId || t?.name === "Combi - Wave 3");
  if (passes.length !== 1) return fail("ordinary Combi Wave 3 missing or ambiguous");
  const [key, ticket]: [string, any] = passes[0];
  const pivots = data.pivots["shops-tickets"].filter((p: any) => p?.ticket_guid === passId);
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket) || key !== passId || ticket.guid !== passId || ticket.event_id !== eventId || ticket.name !== "Combi - Wave 3"
    || pivots.length !== 1 || pivots[0].shop_guid !== ALCATRAZ_SHOP || pivots[0].preceded_by !== null
    || ticket.class !== "PlayPass" || ticket.deleted_at !== null || ticket.hide_without_coupon !== false || ticket.require_coupon !== false
    || ticket.seated !== false || ticket.combines_products !== true || ticket.status_overrule !== "auto"
    || !Number.isSafeInteger(ticket.min_price) || ticket.min_price <= 0 || ticket.increment !== 1
    || ticket.min_orderable_amount_per_order !== 1 || !Number.isSafeInteger(ticket.max_orderable_amount_per_order) || ticket.max_orderable_amount_per_order < 1
    || typeof ticket.available_from !== "string" || !Number.isFinite(Date.parse(ticket.available_from)) || Date.parse(ticket.available_from) > Date.parse(dates.fetchedAt)
    || ticket.available_until !== null && (typeof ticket.available_until !== "string" || !Number.isFinite(Date.parse(ticket.available_until)) || Date.parse(ticket.available_until) <= Date.parse(dates.fetchedAt)))
    return fail("ordinary admission binding/visibility/sale window/schema changed");
  if (ticket.status !== "available") return fail("ordinary Wave 3 not available; other admission inventory is unknown");
  return { status: "available", ticketsUrl: ALCATRAZ_PURCHASE,
    excerpt: `Alcatraz Open Air 2027; current ordinary festival event; Combi - Wave 3; EUR ${ticket.min_price / 100}; official public shop ticket status=available; no coupon; sale window active (earlier waves/VIP/camping do not decide event stock)` };
}
