import { alcatrazPurchaseUrl, type AlcatrazProof } from "./alcatraz-ticket-proof.ts";
import type { FestivalCandidate } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

/** Only the observed same-site root→English landing redirect is trusted. */
export function alcatrazPrimaryUrl(configured: string, actual: string): boolean {
  return actual === configured || configured === "https://www.alcatraz.be/" && actual === "https://www.alcatraz.be/en/";
}

export function observeAlcatrazStock(body: string, proof: AlcatrazProof, dates?: Pick<FestivalCandidate, "startDate" | "endDate"> & { fetchedAt?: string }): TicketObservation {
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official alcatraz ticket source requires review: ${reason}` });
  let data; try { data = JSON.parse(body); } catch { return fail("invalid public shop JSON"); }
  if (!dates?.fetchedAt || !Number.isFinite(Date.parse(dates.fetchedAt)) || dates.startDate !== proof.startDate || dates.endDate !== proof.endDate)
    return fail("current primary festival dates/check time absent");
  if (!data || !Array.isArray(data.shops) || data.shops.length !== 1 || data.shops[0]?.guid !== proof.shopId
    || data.shops[0].name !== proof.eventName || data.shops[0].currency !== "EUR" || data.shops[0].event_selection !== "auto"
    || !Array.isArray(data.events) || data.events.length > 30 || !data.tickets || typeof data.tickets !== "object" || Array.isArray(data.tickets)
    || Object.keys(data.tickets).length > 300 || !Array.isArray(data.pivots?.["shops-tickets"])) return fail("shop/event/ticket schema or current identity changed");
  const events = data.events.filter((e: any) => e?.guid === proof.eventId || e?.name === proof.eventName);
  if (events.length !== 1 || events[0].guid !== proof.eventId || events[0].name !== proof.eventName || events[0].status !== "normal"
    || events[0].currency !== "EUR" || events[0].start !== proof.eventStart || events[0].end !== proof.eventEnd)
    return fail("ordinary festival event edition/date/status changed");
  const passes = Object.entries(data.tickets).filter(([id, t]: [string, any]) => id === proof.passId || t?.guid === proof.passId || t?.name === proof.passName);
  if (passes.length !== 1) return fail("reviewed ordinary pass missing or ambiguous");
  const [key, ticket]: [string, any] = passes[0];
  const pivots = data.pivots["shops-tickets"].filter((p: any) => p?.ticket_guid === proof.passId);
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket) || key !== proof.passId || ticket.guid !== proof.passId || ticket.event_id !== proof.eventId || ticket.name !== proof.passName
    || pivots.length !== 1 || pivots[0].shop_guid !== proof.shopId || pivots[0].preceded_by !== null
    || ticket.class !== "PlayPass" || ticket.deleted_at !== null || ticket.hide_without_coupon !== false || ticket.require_coupon !== false
    || ticket.seated !== false || ticket.combines_products !== true || ticket.status_overrule !== "auto"
    || !Number.isSafeInteger(ticket.min_price) || ticket.min_price <= 0 || ticket.increment !== 1
    || ticket.min_orderable_amount_per_order !== 1 || !Number.isSafeInteger(ticket.max_orderable_amount_per_order) || ticket.max_orderable_amount_per_order < 1
    || typeof ticket.available_from !== "string" || !Number.isFinite(Date.parse(ticket.available_from)) || Date.parse(ticket.available_from) > Date.parse(dates.fetchedAt)
    || ticket.available_until !== null && (typeof ticket.available_until !== "string" || !Number.isFinite(Date.parse(ticket.available_until)) || Date.parse(ticket.available_until) <= Date.parse(dates.fetchedAt)))
    return fail("ordinary admission binding/visibility/sale window/schema changed");
  if (ticket.status !== "available") return fail("reviewed ordinary pass not available; other admission inventory is unknown");
  return { status: "available", ticketsUrl: alcatrazPurchaseUrl(proof),
    excerpt: `${proof.eventName}; current ordinary festival event; ${proof.passName}; EUR ${ticket.min_price / 100}; official public shop ticket status=available; no coupon; sale window active (earlier waves/VIP/camping do not decide event stock)` };
}
