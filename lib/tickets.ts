import type { Festival } from "@/lib/domain/festival";

type TicketLabel = "officialTickets" | "ticketsLow" | "ticketsNotOnSale" | "ticketsSoldOut" | "ticketsSalesEnded" | "ticketsUnavailable" | "ticketsUnknown";
export type TicketPresentation = { status: Festival["ticketStatus"]; href?: string; label: TicketLabel };

export function ticketPresentation(item: Festival): TicketPresentation {
  const href = item.ticketsUrl || undefined;
  // A missing link cannot prove a sellout. Keep known negative states truthful,
  // but do not advertise an actionable offer without an official destination.
  if (item.ticketStatus === "available" && !href) {
    return { status: "unknown", label: "ticketsUnknown" };
  }
  switch (item.ticketStatus) {
    case "available": return { status: "available", href, label: "officialTickets" };
    case "low": return { status: "low", href, label: "ticketsLow" };
    case "not_on_sale": return { status: "not_on_sale", href, label: "ticketsNotOnSale" };
    case "sold_out": return { status: "sold_out", href, label: "ticketsSoldOut" };
    case "sales_ended": return { status: "sales_ended", href, label: "ticketsSalesEnded" };
    case "unavailable": return { status: "unavailable", href, label: "ticketsUnavailable" };
    default: return { status: "unknown", href, label: "ticketsUnknown" };
  }
}

export function hasAvailableTickets(item: Festival) {
  const { status, href } = ticketPresentation(item);
  return Boolean(href) && (status === "available" || status === "low");
}
