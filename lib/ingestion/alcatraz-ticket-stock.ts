import { z } from "zod";
import type { FestivalCandidate, FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

// Audited shop route for this edition; it is an input boundary, not stock evidence.
const shopId = "a22e0ce7-7657-4601-addc-13d7d0cac701";
export const ALCATRAZ_STOCK = `https://shop.api.openticket.tech/${shopId}/data`;
export const ALCATRAZ_PURCHASE = `https://shop.weeztix.com/${shopId}`;

export function isAlcatrazStockSource(source: FestivalSource): boolean {
  return (
    source.festivalSlug === "alcatraz" &&
    source.editionYear === 2027 &&
    (source.url === "https://www.alcatraz.be/" || source.url === "https://www.alcatraz.be/en/") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    !source.strategies.includes("manual_review")
  );
}

const uuid = z.uuid();
const day = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const ordinaryPass = /^Combi - Wave ([1-9]\d?)$/;

/** Only the observed same-site root→English landing redirect is trusted. */
export function alcatrazPrimaryUrl(configured: string, actual: string): boolean {
  return (
    actual === configured ||
    (configured === "https://www.alcatraz.be/" && actual === "https://www.alcatraz.be/en/")
  );
}

export function observeAlcatrazStock(
  body: string,
  year: number,
  dates?: Pick<FestivalCandidate, "startDate" | "endDate"> & { fetchedAt?: string },
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official alcatraz ticket source requires review: ${reason}`,
  });
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return fail("invalid public shop JSON");
  }
  const primary = z.object({ startDate: day, endDate: day, fetchedAt: timestamp }).safeParse(dates);
  if (
    !primary.success ||
    !primary.data.startDate.startsWith(`${year}-`) ||
    !primary.data.endDate.startsWith(`${year}-`) ||
    primary.data.startDate >= primary.data.endDate
  )
    return fail("current primary festival dates/check time absent");
  const { startDate, endDate, fetchedAt } = primary.data;
  const eventName = `Alcatraz Open Air ${year}`;
  if (
    !data ||
    !Array.isArray(data.shops) ||
    data.shops.length !== 1 ||
    data.shops[0]?.guid !== shopId ||
    data.shops[0].name !== eventName ||
    data.shops[0].currency !== "EUR" ||
    data.shops[0].event_selection !== "auto" ||
    !Array.isArray(data.events) ||
    data.events.length > 30 ||
    !data.tickets ||
    typeof data.tickets !== "object" ||
    Array.isArray(data.tickets) ||
    Object.keys(data.tickets).length > 300 ||
    !Array.isArray(data.pivots?.["shops-tickets"])
  )
    return fail("shop/event/ticket schema or current identity changed");
  const events = data.events.filter((event: any) => event?.name === eventName);
  const event = events[0];
  // The seller uses an overnight final endpoint; keep it out of public festival dates.
  if (
    events.length !== 1 ||
    !uuid.safeParse(event.guid).success ||
    data.events.filter((entry: any) => entry?.guid === event.guid).length !== 1 ||
    event.status !== "normal" ||
    event.currency !== "EUR" ||
    !timestamp.safeParse(event.start).success ||
    !timestamp.safeParse(event.end).success ||
    event.start.slice(0, 10) !== startDate ||
    Number(event.end.slice(11, 13)) >= 6 ||
    Date.parse(event.end.slice(0, 10)) - Date.parse(endDate) !== 86_400_000 ||
    Date.parse(event.start) >= Date.parse(event.end) ||
    Date.parse(fetchedAt) >= Date.parse(event.end)
  )
    return fail("ordinary festival event edition/date/status changed");
  const passes = Object.entries(data.tickets)
    .flatMap(([key, ticket]: [string, any]) => {
      const match = typeof ticket?.name === "string" ? ordinaryPass.exec(ticket.name) : null;
      return match ? [{ key, ticket, wave: Number(match[1]) }] : [];
    })
    .sort((left, right) => right.wave - left.wave);
  const selected = passes[0];
  if (!selected || new Set(passes.map((pass) => pass.wave)).size !== passes.length)
    return fail("reviewed ordinary pass missing or ambiguous");
  const { key, ticket } = selected;
  const passId = ticket.guid;
  const pivots = data.pivots["shops-tickets"].filter((pivot: any) => pivot?.ticket_guid === passId);
  if (
    !uuid.safeParse(passId).success ||
    key !== passId ||
    ticket.event_id !== event.guid ||
    pivots.length !== 1 ||
    pivots[0].shop_guid !== shopId ||
    pivots[0].preceded_by !== null ||
    ticket.class !== "PlayPass" ||
    ticket.deleted_at !== null ||
    ticket.hide_without_coupon !== false ||
    ticket.require_coupon !== false ||
    ticket.seated !== false ||
    ticket.combines_products !== true ||
    ticket.status_overrule !== "auto" ||
    !Number.isSafeInteger(ticket.min_price) ||
    ticket.min_price <= 0 ||
    ticket.increment !== 1 ||
    ticket.min_orderable_amount_per_order !== 1 ||
    !Number.isSafeInteger(ticket.max_orderable_amount_per_order) ||
    ticket.max_orderable_amount_per_order < 1 ||
    !timestamp.safeParse(ticket.available_from).success ||
    Date.parse(ticket.available_from) > Date.parse(fetchedAt) ||
    (ticket.available_until !== null &&
      (!timestamp.safeParse(ticket.available_until).success ||
        Date.parse(ticket.available_until) <= Date.parse(fetchedAt)))
  )
    return fail("ordinary admission binding/visibility/sale window/schema changed");
  if (ticket.status !== "available")
    return fail("reviewed ordinary pass not available; other admission inventory is unknown");
  return {
    status: "available",
    ticketsUrl: ALCATRAZ_PURCHASE,
    excerpt:
      `${eventName}; current ordinary festival event; ${ticket.name} (${passId}); EUR ${ticket.min_price / 100}; ` +
      "official public shop ticket status=available; no coupon; sale window active " +
      "(earlier waves/VIP/camping do not decide event stock)",
  };
}
