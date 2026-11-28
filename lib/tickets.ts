import type { Festival } from "@/lib/domain/festival";
import { editionOnHiatus } from "./edition-lifecycle.ts";

type TicketLabel =
  | "editionHiatus"
  | "ticketsInfo"
  | "ticketsFree"
  | "officialTickets"
  | "ticketsLow"
  | "ticketsNotOnSale"
  | "ticketsSoldOut"
  | "ticketsSalesEnded"
  | "ticketsUnavailable"
  | "ticketsUnknown";
export type TicketPresentation = {
  status: Festival["ticketStatus"] | "hiatus";
  href?: string;
  label: TicketLabel;
};

type TicketInput = Pick<
  Festival,
  | "slug"
  | "editionYear"
  | "officialUrl"
  | "editionLifecycle"
  | "ticketStatus"
  | "ticketsUrl"
  | "ticketOffers"
>;

export function ticketPresentation(item: TicketInput): TicketPresentation {
  if (editionOnHiatus(item)) return { status: "hiatus", label: "editionHiatus" };
  // Free, unticketed admission has no purchase flow. Ancillary camping/VIP
  // ticket URLs must not become a misleading general-admission CTA.
  if (item.ticketStatus === "free")
    return { status: "free", href: item.officialUrl || undefined, label: "ticketsFree" };
  // Reviewed mixed categories are not a whole-festival stock claim. The
  // official source is information only, never an inferred resale purchase.
  if (item.ticketOffers)
    return { status: "unknown", href: item.ticketOffers.sourceUrl, label: "ticketsInfo" };
  const href = item.ticketsUrl || undefined;
  // A missing link cannot prove a sellout. Keep known negative states truthful,
  // but do not advertise an actionable offer without an official destination.
  if (item.ticketStatus === "available" && !href) {
    return { status: "unknown", label: "ticketsUnknown" };
  }
  switch (item.ticketStatus) {
    case "available":
      return { status: "available", href, label: "officialTickets" };
    case "low":
      return { status: "low", href, label: "ticketsLow" };
    case "not_on_sale":
      return { status: "not_on_sale", href, label: "ticketsNotOnSale" };
    case "sold_out":
      return { status: "sold_out", href, label: "ticketsSoldOut" };
    case "sales_ended":
      return { status: "sales_ended", href, label: "ticketsSalesEnded" };
    case "unavailable":
      return { status: "unavailable", href, label: "ticketsUnavailable" };
    default:
      return { status: "unknown", href, label: "ticketsUnknown" };
  }
}

export function hasAvailableTickets(item: Festival) {
  const { status, href } = ticketPresentation(item);
  return Boolean(href) && (status === "available" || status === "low");
}
