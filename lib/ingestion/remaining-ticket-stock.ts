import { RESURRECTION_PRODUCTS, observeResurrectionStock } from "./resurrection-ticket-stock.ts";
import { load, type CheerioAPI } from "cheerio";
import type { FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

export const JERA_STOCK = "https://www.impericon.com/nl/products/jera-on-air-24-25-26-06-2027-weekend-ticket.js";
export const TREES_STOCK = "https://tickets.2000trees.co.uk/events/2000trees/2213997";

/** Exact reviewed 2027 routes only. An edition rollover needs a new audit. */
export function remainingTicketUrl(source: FestivalSource): string | undefined {
  if (source.editionYear !== 2027) return;
  const routes: Record<string, { sources: string[]; stock: string }> = {
    "resurrection-fest": { sources: ["https://www.resurrectionfest.es/"], stock: RESURRECTION_PRODUCTS },
    "2000trees": { sources: ["https://2000trees.co.uk/"], stock: TREES_STOCK },
    "pinkpop": { sources: ["https://www.pinkpop.nl/"], stock: "https://www.pinkpop.nl/tickets/" },
    "eurockeennes": { sources: ["https://www.eurockeennes.fr/"], stock: "https://www.eurockeennes.fr/achat/" },
    "jera-on-air": { sources: ["https://www.jeraonair.nl/en/info/", "https://www.jeraonair.nl/en/line-up/"], stock: JERA_STOCK },
  };
  const route = routes[source.festivalSlug];
  return route?.sources.includes(source.url) ? route.stock : undefined;
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
  if (source.festivalSlug === "jera-on-air") {
    let p; try { p = JSON.parse(html); } catch { return fail("invalid public product JSON"); }
    if (!p || p.vendor !== "Jera On Air" || p.type !== "Hardtickets"
      || p.handle !== "jera-on-air-24-25-26-06-2027-weekend-ticket"
      || p.url !== "/nl/products/jera-on-air-24-25-26-06-2027-weekend-ticket"
      || p.title !== "24./25./26.06.2027 Weekend - Ticket"
      || typeof p.available !== "boolean" || !Number.isSafeInteger(p.price) || p.price <= 0
      || !Array.isArray(p.variants) || p.variants.length !== 1) return fail("ordinary weekend product identity/schema changed");
    const v = p.variants[0];
    if (!v || v.sku !== "TIKJER27WEE" || !Number.isSafeInteger(v.id) || v.id <= 0
      || v.title !== "Default Title" || typeof v.available !== "boolean" || v.available !== p.available
      || v.price !== p.price || v.requires_selling_plan !== false) return fail("weekend variant stock/schema changed");
    if (!p.available) return fail("weekend hardticket unavailable; other admission inventory is unknown");
    return pass(`Jera On Air 2027; ordinary weekend hardticket; public product and variant available=true; ${v.sku}`);
  }
  const $ = load(html);
  if (source.festivalSlug === "2000trees") {
    const events: any[] = [];
    $("script[type='application/ld+json']").each((_, el) => {
      try { const data = JSON.parse($(el).text()); for (const x of Array.isArray(data) ? data : data?.["@graph"] ?? [data]) if (x?.["@type"] === "Event") events.push(x); } catch { /* no evidence */ }
    });
    visible($);
    if (events.length !== 1) return fail("current shop event missing or ambiguous");
    const e = events[0];
    if (e.name !== "2000trees 2027 20th Anniversary Special" || !text($("title").text()).includes(e.name)
      || e.startDate !== "2027-07-07T12:00:00+01:00" || e.endDate !== "2027-07-11T15:00:00+01:00"
      || e.eventStatus !== "https://schema.org/EventScheduled" || !Array.isArray(e.offers) || e.offers.length > 100)
      return fail("current scheduled event identity changed");
    const buy = $("a#buy_tickets_button").filter((_, el) => enabled($, el) && text($(el).text()) === "BUY EARLY BIRD TICKETS"
      && /^\/checkout\/view-event\/id\/8296090\/chk\/[a-z0-9]+\/\?modal_widget=true&widget=true$/.test($(el).attr("href") ?? ""));
    if (!buy.length) return fail("current enabled purchase control absent");
    const ordinary = e.offers.filter((o: any) => o?.["@type"] === "Offer" && typeof o.name === "string"
      && /^(?:Weekend Ticket \(Thurs - Sat\)|[34] Day Festival Ticket \((?:Thurs|Wed) - Sat\))\s*-?\s*(?:Super Early Bird|Early Bird)$/.test(o.name));
    if (ordinary.some((o: any) => o.url !== url || o.priceCurrency !== "GBP" || typeof o.price !== "number" || !Number.isFinite(o.price) || o.price <= 0
      || !["https://schema.org/InStock", "https://schema.org/SoldOut", "https://schema.org/OutOfStock"].includes(o.availability)))
      return fail("ordinary admission offer schema changed");
    if (new Set(ordinary.map((o: any) => o.name)).size !== ordinary.length) return fail("duplicate ordinary admission offers");
    const available = ordinary.find((o: any) => o.availability === "https://schema.org/InStock");
    return available ? pass(`2000trees 2027; ${available.name}; GBP ${available.price}; schema.org/InStock and enabled shop purchase control`)
      : fail("no verified in-stock ordinary admission; accessory/child stock is insufficient");
  }
  visible($);
  if (source.festivalSlug === "pinkpop") {
    if (text($("title").text()) !== "Tickets – Pinkpop 2027" || text($("h1").text()) !== "Tickets") return fail("current ticket page identity absent");
    const statement = $("p").filter((_, e) => /^De reguliere ticketverkoop voor Pinkpop 2027 is reeds gestart\./.test(text($(e).text()))
      && /Tickets zijn beschikbaar voor iedereen, zolang de voorraad strekt/.test(text($(e).text())) && !negative.test(text($(e).text())));
    if (statement.length !== 1) return fail("current ordinary on-sale assertion absent or ambiguous");
    const cards = $("article.product").filter((_, e) => text($(e).find("h3").text()) === "Regulier"
      && $(e).find("[data-src='https://www.pinkpop.nl/tickets/festivaltickets-weekend-regulier/?ajax=1']").length > 0);
    if (cards.length !== 1) return fail("ordinary weekend card absent or duplicated");
    const card = cards.first();
    const buy = card.find("a.ticket").filter((_, el) => enabled($, el) && $(el).attr("href") === "https://www.ticketmaster.nl/event/1884453946" && text($(el).text()) === "Koop ticket");
    if (!enabled($, card) || negative.test(text(card.text())) || buy.length !== 1 || !/^€\s*\d+(?:[.,]\d+)?$/.test(text(card.find(".price").text()))
      || text(card.find(".summary").text()) !== "Toegang tot het festivalterrein en de Festivalcamping") return fail("ordinary weekend stock/control missing or conflicting");
    return pass(`Pinkpop 2027; Regulier weekend; explicit tickets beschikbaar; ${text(card.find(".price").text())}; enabled Ticketmaster Koop ticket`);
  }
  if (source.festivalSlug === "eurockeennes") {
    if (!/^Billetterie \| Les Eurockéennes de Belfort – 2, 3, 4 et 5 juillet 2027\b/.test(text($("title").text()))) return fail("current ticket page edition absent");
    // Cheerio text() merges <br> words, so use a structural separator before reading.
    $("br").replaceWith(" ");
    const passCards = $("a.lkbill27").filter((_, e) => text($(e).find("#titblocarr").text()) === "FORFAIT 4 JOURS");
    if (passCards.length !== 1) return fail("ordinary four-day pass absent or duplicated");
    const card = passCards.first(), copy = text(card.text());
    const widget = $("a.weezevent-widget-integration").filter((_, e) => enabled($, e) && $(e).attr("href") === "https://widget.weezevent.com/ticket/91a253ee-12da-4261-ba09-4270b6d7108c?locale=fr-FR");
    if (!enabled($, card) || card.attr("href") !== "/achat/" || !widget.length || negative.test(copy)
      || !/^\d+\s*€$/.test(text(card.find("#desccarr").text()))
      || !/^Disponible(?: OFFRE LIMITÉE)?$/.test(text(card.find("#mentionfinbill").text()))) return fail("ordinary pass availability/control missing or conflicting");
    return pass(`Eurockéennes 2027; FORFAIT 4 JOURS; ${text(card.find("#desccarr").text())}; Disponible; enabled official Weezevent widget (limited price offer is not low inventory)`);
  }
  return fail("unreviewed adapter");
}
