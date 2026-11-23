import { load } from "cheerio";
import type { FestivalSource, FestivalCandidate } from "./types.ts";

import { observeRemainingTicket, remainingTicketUrl } from "./remaining-ticket-stock.ts";

export const TICKET_SUPPLEMENT = "official-ticket-supplement-v1";
type TicketState = NonNullable<FestivalCandidate["ticketStatus"]>;
export type TicketObservation = { status?: TicketState; excerpt: string; warning?: string; ticketsUrl?: string };

/** Reviewed source routes, not URLs supplied by arbitrary markup or API clients. */
export function ticketSupplementUrl(source: FestivalSource): string | undefined {
  if (source.fetchUrl || source.followLinkPattern || source.strategies.includes("manual_review")) return;
  const remaining = remainingTicketUrl(source);
  if (remaining) return remaining;
  let url: URL; try { url = new URL(source.url); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return;
  if (source.festivalSlug === "full-rewind" && url.href === "https://full-rewind.de/" && source.strategies.includes("official_markup")
    && Number.isInteger(source.editionYear) && source.editionYear >= 2027 && source.editionYear <= 2100)
    return "https://full-rewind.de/products/full-rewind-weekend-ticket-" + source.editionYear + ".js";
  if (source.festivalSlug === "download" && url.hostname === "downloadfestival.co.uk" && url.pathname === "/")
    return "https://downloadfestival.co.uk/tickets/";
  if (source.festivalSlug === "wacken-open-air" && url.hostname === "www.wacken.com" && url.pathname === "/")
    return `https://www.wacken.com/de/tickets-shop/ticket-uebersicht-${source.editionYear}/`;
}

/** Human purchase destination can differ from the machine-readable stock URL. */
export function ticketSupplementPurchaseUrl(source: FestivalSource): string | undefined {
  const stockUrl = ticketSupplementUrl(source);
  if (!stockUrl) return;
  return source.festivalSlug === "full-rewind" ? `https://full-rewind.de/collections/tickets-${source.editionYear}` : stockUrl;
}

export function isTicketSupplementUrl(source: FestivalSource, actual: string): boolean {
  return actual === ticketSupplementUrl(source);
}

export function observeTicketSupplement(html: string, source: FestivalSource, url: string, dates?: Pick<FestivalCandidate, "startDate" | "endDate">): TicketObservation {
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official ${source.festivalSlug} ticket source requires review: ${reason}` });
  if (!isTicketSupplementUrl(source, url) || html.length > 2_000_000) return fail("source identity or size changed");
  if (source.festivalSlug === "full-rewind") {
    const year = source.editionYear;
    try {
      const product = JSON.parse(html);
      const title = "Full Rewind Weekend Ticket " + year, handle = "full-rewind-weekend-ticket-" + year;
      if (!product || product.title !== title || product.handle !== handle || product.url !== "/products/" + handle
        || product.vendor !== "Full Rewind" || product.requires_selling_plan !== false || typeof product.available !== "boolean"
        || !Number.isSafeInteger(product.price) || product.price <= 0 || typeof product.description !== "string"
        || !Array.isArray(product.variants) || product.variants.length !== 1)
        return fail("standard weekend product identity or schema changed");
      const $product = load(product.description);
      $product("script, style, template, [hidden], [aria-hidden='true']").remove();
      const description = $product("p").first().text().replace(/\s+/g, " ").trim();
      const range = description.match(/^Full Rewind \((\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{2})\.(20\d{2})\) Weekend Ticket beinhaltet ein Weekend Ticket inkl\. Camping\./);
      if (!range || Number(range[4]) !== year) return fail("weekend admission edition/dates absent");
      const iso = (day: string) => range[4] + "-" + range[3] + "-" + day.padStart(2, "0");
      const start = iso(range[1]), end = iso(range[2]);
      if (!dates?.startDate || !dates.endDate || start !== dates.startDate || end !== dates.endDate)
        return fail("weekend admission dates disagree with verified official festival dates");
      const variant = product.variants[0], quantity = variant?.quantity_rule;
      if (!variant || variant.title !== "Default Title" || variant.name !== title || variant.sku !== "T-" + year + "-Weekend"
        || typeof variant.available !== "boolean" || variant.available !== product.available
        || variant.requires_selling_plan !== false || !Number.isSafeInteger(variant.price) || variant.price <= 0 || variant.price !== product.price
        || !quantity || quantity.min !== 1 || quantity.increment !== 1
        || !(quantity.max === null || Number.isSafeInteger(quantity.max) && quantity.max >= 1))
        return fail("standard weekend variant inventory or quantity schema changed");
      // Shopify false means unavailable for purchase, not a confirmed global
      // sellout. Parking stock and shipping deadlines are not admission stock.
      return { status: product.available ? "available" : "unavailable",
        ticketsUrl: "https://full-rewind.de/collections/tickets-" + year,
        excerpt: title + "; " + start + "–" + end + "; official Shopify standard weekend variant available=" + product.available };
    } catch { return fail("invalid public weekend product JSON"); }
  }
  if (remainingTicketUrl(source)) return observeRemainingTicket(html, source, dates);
  const $ = load(html);
  const declaredEvents: Array<{ name?: unknown; startDate?: unknown; endDate?: unknown; eventStatus?: unknown }> = [];
  if (source.festivalSlug === "download") $("script[type='application/ld+json']").each((_, element) => {
    try {
      const value = JSON.parse($(element).text());
      if (value && value["@type"] === "Event") declaredEvents.push(value);
    } catch { /* Missing or invalid edition evidence remains review-required. */ }
  });
  // Edition metadata above is not an inventory assertion. Ticket stock below
  // must come from the visible reviewed product structure, never generic text.
  $("script, style, noscript, template, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove(); });
  const text = (value: string) => value.replace(/\s+/g, " ").trim();
  $("nav, footer").remove();
  const year = source.editionYear;
  if (source.festivalSlug === "wacken-open-air") {
    if (!new RegExp(`Ticket.*${year}`).test($("title").text())) return fail("current edition title absent");
    const cards = $(".wt-card").filter((_, card) => text($(card).find(".wt-card__name").text()) === "Louder");
    if (cards.length !== 1) return fail("standard festival-pass card absent or ambiguous");
    const card = cards.first(), statement = text(card.text());
    if (!new RegExp(`Wacken Open Air ${year}\\b`, "i").test(statement) || !/Festivalpass/i.test(statement)) return fail("standard pass edition unverified");
    const buy = card.find("a.wt-card__btn").filter((_, anchor) => {
      const link = $(anchor);
      return link.attr("href") === `https://ticketstore.wacken.com/de/wacken-open-air-${year}/4-day-tickets`
        && !link.is("[disabled], [aria-disabled='true']") && /Louder Ticket kaufen/i.test(text(link.text()));
    });
    const soldOut = card.hasClass("wt-card--soldout") && /^(?:Sold Out|Ausverkauft)$/i.test(text(card.find(".wt-card__badge").text()));
    if (soldOut && buy.length) return fail("conflicting standard-pass stock and purchase evidence");
    if (soldOut) return { status: "sold_out", excerpt: `Wacken Open Air ${year}; standard Louder festival pass; ${text(card.find(".wt-card__badge").text())}` };
    if (buy.length === 1 && /^€\s*\d+(?:[.,]\d+)?$/.test(text(card.find(".wt-card__price").text())))
      return { status: "available", excerpt: `Wacken Open Air ${year}; standard Louder festival pass; ${text(buy.text())}; ${text(card.find(".wt-card__price").text())}` };
    return fail("no verified standard-pass inventory");
  }
  if (source.festivalSlug === "download") {
    const event = declaredEvents.length === 1 ? declaredEvents[0] : undefined;
    if (!event || event.name !== "Download Festival" || typeof event.startDate !== "string" || typeof event.endDate !== "string"
      || !event.startDate.startsWith(`${year}-`) || !event.endDate.startsWith(`${year}-`)
      || !Number.isFinite(Date.parse(event.startDate)) || !Number.isFinite(Date.parse(event.endDate)) || event.startDate >= event.endDate
      || event.eventStatus && event.eventStatus !== "https://schema.org/EventScheduled"
      || !/^Download Festival \| Tickets$/.test(text($("title").text())))
      return fail("current festival ticket page identity absent");
    const regular = $(".tg").filter((_, group) => ["General Camping", "Weekend Arena Only"].includes(text($(group).children(".group-title").text())));
    if (regular.length !== 2) return fail("regular admission groups absent or duplicated");
    const cards = regular.find(".ticket-card");
    const expected = new Set(["5 Nights", "3 Nights", "Weekend Arena Only"]);
    const titles = cards.map((_, card) => text($(card).find(".t-title").text())).get();
    if (cards.length !== 3 || new Set(titles).size !== 3 || titles.some(title => !expected.has(title))) return fail("regular admission product schema changed");
    let available: string | undefined;
    for (const element of cards.toArray()) {
      const card = $(element), title = text(card.find(".t-title").text());
      const purchase = card.find("a[href]").filter((_, anchor) => {
        const link = $(anchor);
        try {
          const target = new URL(link.attr("href") ?? "");
          return target.protocol === "https:" && target.hostname === "www.ticketmaster.co.uk" && !target.username && !target.password && !target.port
            && /^\/event\/[A-Za-z0-9]+$/.test(target.pathname) && !link.is("[disabled], [aria-disabled='true']")
            && text(link.text()).startsWith(`Buy Now: ${title}`);
        } catch { return false; }
      });
      const sold = card.hasClass("so") && /^Sold Out$/i.test(text(card.find(".swash").text()));
      if (sold && purchase.length) return fail("conflicting product stock and purchase evidence");
      if (purchase.length > 1) return fail("ambiguous product purchase destination");
      if (!sold && purchase.length === 1) available = title;
    }
    if (available) return { status: "available", excerpt: `Download Festival ${year}; regular admission ${available}; enabled official Ticketmaster Buy Now control` };
    // Other categories can still include entry; three sold-out regular products
    // are not proof that the whole festival or every ticket type has sold out.
    return fail("no verified purchasable regular admission; whole-event sellout not established");
  }
  return fail("no reviewed ticket adapter");
}
