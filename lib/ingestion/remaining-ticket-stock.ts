import { getRemainingProof } from "./remaining-ticket-proof.ts";
import { RESURRECTION_PRODUCTS, observeResurrectionStock } from "./resurrection-ticket-stock.ts";
import { load, type CheerioAPI } from "cheerio";
import type { FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

/** Stock destinations are limited to the reviewed provider host and route. */
export function remainingTicketUrl(source: FestivalSource): string | undefined {
  if (source.festivalSlug === "resurrection-fest" && source.url === "https://www.resurrectionfest.es/" && source.editionYear === 2027)
    return RESURRECTION_PRODUCTS;
  const proof = getRemainingProof(source);
  switch (proof?.kind) {
    case "jera": return `https://www.impericon.com/nl/products/${proof.handle}.js`;
    case "trees": return `https://tickets.2000trees.co.uk/events/2000trees/${proof.shopId}`;
    case "pinkpop": return "https://www.pinkpop.nl/tickets/";
    case "eurockeennes": return "https://www.eurockeennes.fr/achat/";
  }
}

const text = (value: string) => value.replace(/\s+/g, " ").trim();
function visible($: CheerioAPI) {
  $("script,style,noscript,template,nav,footer,.hidden,.d-none,[hidden],[inert],[aria-hidden='true']").remove();
  $("[style]").each((_, e) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style") ?? "")) $(e).remove(); });
}
function enabled($: CheerioAPI, node: Parameters<CheerioAPI>[0]) {
  const el = $(node);
  return !el.is("[disabled],[aria-disabled='true'],.disabled,.sold-out,.soldout")
    && !el.parents("[disabled],[aria-disabled='true'],.disabled,.sold-out,.soldout").length;
}
const negative = /sold\s*out|uitverkocht|épuisé|indisponible|bientôt|prochainement|not\s+(?:yet\s+)?(?:on sale|available)/i;

export function observeRemainingTicket(html: string, source: FestivalSource, url: string): TicketObservation | undefined {
  if (!remainingTicketUrl(source)) return;
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official ${source.festivalSlug} ticket source requires review: ${reason}` });
  const pass = (excerpt: string): TicketObservation => ({ status: "available", excerpt });
  if (url !== remainingTicketUrl(source)) return fail("stock route identity changed");
  if (source.festivalSlug === "resurrection-fest") return observeResurrectionStock(html);
  const proof = getRemainingProof(source);
  if (proof?.kind === "jera") {
    let p; try { p = JSON.parse(html); } catch { return fail("invalid public product JSON"); }
    if (!p || p.vendor !== "Jera On Air" || p.type !== "Hardtickets"
      || p.handle !== proof.handle
      || p.url !== `/nl/products/${proof.handle}`
      || p.title !== proof.title
      || typeof p.available !== "boolean" || !Number.isSafeInteger(p.price) || p.price <= 0
      || !Array.isArray(p.variants) || p.variants.length !== 1) return fail("ordinary weekend product identity/schema changed");
    const v = p.variants[0];
    if (!v || v.sku !== proof.sku || !Number.isSafeInteger(v.id) || v.id <= 0
      || v.title !== "Default Title" || typeof v.available !== "boolean" || v.available !== p.available
      || v.price !== p.price || v.requires_selling_plan !== false) return fail("weekend variant stock/schema changed");
    if (!p.available) return fail("weekend hardticket unavailable; other admission inventory is unknown");
    return pass(`Jera On Air ${proof.editionYear}; ordinary weekend hardticket; public product and variant available=true; ${v.sku}`);
  }
  const $ = load(html);
  if (proof?.kind === "trees") {
    const events: any[] = [];
    $("script[type='application/ld+json']").each((_, el) => {
      try { const data = JSON.parse($(el).text()); for (const x of Array.isArray(data) ? data : data?.["@graph"] ?? [data]) if (x?.["@type"] === "Event") events.push(x); } catch { /* no evidence */ }
    });
    visible($);
    if (events.length !== 1) return fail("current shop event missing or ambiguous");
    const e = events[0];
    if (e.name !== proof.eventName || !text($("title").text()).includes(e.name)
      || e.startDate !== proof.eventStart || e.endDate !== proof.eventEnd
      || e.eventStatus !== "https://schema.org/EventScheduled" || !Array.isArray(e.offers) || e.offers.length > 100)
      return fail("current scheduled event identity changed");
    const buy = $("a#buy_tickets_button").filter((_, el) => enabled($, el) && text($(el).text()) === "BUY EARLY BIRD TICKETS"
      && /^\/checkout\/view-event\/id\/(\d+)\/chk\/[a-z0-9]+\/\?modal_widget=true&widget=true$/.exec($(el).attr("href") ?? "")?.[1] === proof.checkoutId);
    if (!buy.length) return fail("current enabled purchase control absent");
    const ordinary = e.offers.filter((o: any) => o?.["@type"] === "Offer" && typeof o.name === "string"
      && /^(?:Weekend Ticket \(Thurs - Sat\)|[34] Day Festival Ticket \((?:Thurs|Wed) - Sat\))\s*-?\s*(?:Super Early Bird|Early Bird)$/.test(o.name));
    if (ordinary.some((o: any) => o.url !== url || o.priceCurrency !== "GBP" || typeof o.price !== "number" || !Number.isFinite(o.price) || o.price <= 0
      || !["https://schema.org/InStock", "https://schema.org/SoldOut", "https://schema.org/OutOfStock"].includes(o.availability)))
      return fail("ordinary admission offer schema changed");
    if (new Set(ordinary.map((o: any) => o.name)).size !== ordinary.length) return fail("duplicate ordinary admission offers");
    const available = ordinary.find((o: any) => o.availability === "https://schema.org/InStock");
    return available ? pass(`2000trees ${proof.editionYear}; ${available.name}; GBP ${available.price}; schema.org/InStock and enabled shop purchase control`)
      : fail("no verified in-stock ordinary admission; accessory/child stock is insufficient");
  }
  visible($);
  if (proof?.kind === "pinkpop") {
    if (text($("title").text()) !== proof.title || text($("h1").text()) !== "Tickets") return fail("current ticket page identity absent");
    const statement = $("p").filter((_, e) => text($(e).text()).startsWith(proof.onSale)
      && /Tickets zijn beschikbaar voor iedereen, zolang de voorraad strekt/.test(text($(e).text())) && !negative.test(text($(e).text())));
    if (statement.length !== 1) return fail("current ordinary on-sale assertion absent or ambiguous");
    const cards = $("article.product").filter((_, e) => text($(e).find("h3").text()) === "Regulier"
      && $(e).find("[data-src='https://www.pinkpop.nl/tickets/festivaltickets-weekend-regulier/?ajax=1']").length > 0);
    if (cards.length !== 1) return fail("ordinary weekend card absent or duplicated");
    const card = cards.first();
    const buy = card.find("a.ticket").filter((_, el) => enabled($, el) && $(el).attr("href") === `https://www.ticketmaster.nl/event/${proof.ticketmasterId}` && text($(el).text()) === "Koop ticket");
    if (!enabled($, card) || negative.test(text(card.text())) || buy.length !== 1 || !/^€\s*\d+(?:[.,]\d+)?$/.test(text(card.find(".price").text()))
      || text(card.find(".summary").text()) !== "Toegang tot het festivalterrein en de Festivalcamping") return fail("ordinary weekend stock/control missing or conflicting");
    return pass(`Pinkpop ${proof.editionYear}; Regulier weekend; explicit tickets beschikbaar; ${text(card.find(".price").text())}; enabled Ticketmaster Koop ticket`);
  }
  if (proof?.kind === "eurockeennes") {
    if (!text($("title").text()).startsWith(proof.titlePrefix) || /^\w/.test(text($("title").text()).slice(proof.titlePrefix.length))) return fail("current ticket page edition absent");
    // Cheerio text() merges <br> words, so use a structural separator before reading.
    $("br").replaceWith(" ");
    const passCards = $(`a.${proof.cardClass}`).filter((_, e) => text($(e).find("#titblocarr").text()) === "FORFAIT 4 JOURS");
    if (passCards.length !== 1) return fail("ordinary four-day pass absent or duplicated");
    const card = passCards.first(), copy = text(card.text());
    const widget = $("a.weezevent-widget-integration").filter((_, e) => enabled($, e) && $(e).attr("href") === `https://widget.weezevent.com/ticket/${proof.widgetId}?locale=fr-FR`);
    if (!enabled($, card) || card.attr("href") !== "/achat/" || !widget.length || negative.test(copy)
      || !/^\d+\s*€$/.test(text(card.find("#desccarr").text()))
      || !/^Disponible(?: OFFRE LIMITÉE)?$/.test(text(card.find("#mentionfinbill").text()))) return fail("ordinary pass availability/control missing or conflicting");
    return pass(`Eurockéennes ${proof.editionYear}; FORFAIT 4 JOURS; ${text(card.find("#desccarr").text())}; Disponible; enabled official Weezevent widget (limited price offer is not low inventory)`);
  }
  return fail("unreviewed adapter");
}
