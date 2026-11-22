import { load } from "cheerio";
import type { TicketObservation } from "../ticket-supplements.ts";

// Reviewed ordinary admission product, not the listing, camping or an upgrade.
// Deliberately edition-specific: a future product needs a new reviewed identity.
export const TOLMINATOR_PRODUCT = "https://tolminator.mojekarte.si/si/tolminator-2027-festivalska-vstopnica-predprodaja-1-210-eur/vstopnice-1235366.html";
const title = "TOLMINATOR 2027 FESTIVALSKA VSTOPNICA - PREDPRODAJA 1 - 210 EUR";
const purchaseAction = "https://tolminator.mojekarte.si/si/basket/add/1235366";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Pure stock observation only. Never requests the action URL, publishes dates,
 * price/fees or infers inventory from the visible price/buy control alone.
 * Transport and canonical persisted-proof integration remain separate gates. */
export function observeTolminatorStock(html: string, url: string, year: number, observedAt: string): TicketObservation {
  const fail = (reason: string): TicketObservation => ({ excerpt: "", warning: `Official tolminator ticket source requires review: ${reason}` });
  const now = Date.parse(observedAt);
  if (url !== TOLMINATOR_PRODUCT || year !== 2027 || !Number.isFinite(now) || Buffer.byteLength(html, "utf8") > 2_000_000)
    return fail("source, edition, time or size changed");
  const $ = load(html);
  // Remove hidden containers before metadata extraction too: hidden Event nodes
  // cannot corroborate visible ordinary admission, including hidden ancestors.
  $("style, noscript, template, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
  });
  const events: Record<string, any>[] = [];
  let invalidJson = false;
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const document = JSON.parse($(element).text());
      if (!document || !Array.isArray(document["@graph"]) || document["@graph"].length > 100) { invalidJson = true; return; }
      for (const node of document["@graph"]) {
        if (node?.["@type"] === "Event") events.push(node);
      }
    } catch { invalidJson = true; }
  });
  if (invalidJson || events.length !== 1) return fail("unique valid Event metadata absent");
  const event = events[0], aggregate = event.offers;
  if (event.name !== title || event.url !== url || event.startDate !== "2027-07-28T00:00:00+02:00"
    || event.endDate !== "2027-07-31T00:00:00+02:00"
    || (event.eventStatus !== undefined && !["EventScheduled", "https://schema.org/EventScheduled"].includes(event.eventStatus))
    || aggregate?.["@type"] !== "AggregateOffer" || aggregate.offerCount !== 1 || aggregate.priceCurrency !== "EUR"
    || aggregate.lowPrice !== "210" || aggregate.highPrice !== "210"
    || !Array.isArray(aggregate.offers) || aggregate.offers.length !== 1)
    return fail("ordinary product identity or offer schema changed");
  const offer = aggregate.offers[0];
  if (offer?.["@type"] !== "Offer" || offer.name !== "Cena" || offer.url !== purchaseAction
    || offer.price !== "210" || offer.priceCurrency !== "EUR" || offer.availability !== "In stock"
    || typeof offer.validFrom !== "string" || typeof offer.validThrough !== "string"
    || !Number.isFinite(Date.parse(offer.validFrom)) || !Number.isFinite(Date.parse(offer.validThrough))
    || Date.parse(offer.validFrom) > now || Date.parse(offer.validThrough) <= now)
    return fail("explicit current ordinary inventory absent or conflicting");
  $("script, nav, footer").remove();
  if (normalize($("h1.show-for-small-only").text()) !== title
    || normalize($("title").text()) !== `Vstopnice za ${title}, 28.07.2027 ob 00:00 (si)`
    || $(".description-prices-list").length !== 1
    || normalize($(".description-prices-list").text()) !== "210,00 EUR Cena")
    return fail("visible product identity or price differs");
  const buy = $("a.description-buy-link");
  if (buy.length !== 1 || buy.attr("href") !== purchaseAction || normalize(buy.text()) !== "Nakup vstopnic"
    || buy.is("[disabled], [aria-disabled='true']") || buy.parents("[disabled], [aria-disabled='true']").length)
    return fail("visible ordinary purchase control absent or disabled");
  if (/razprodano|ni na voljo|sold\s*out|off\s*sale/i.test($("body").text()))
    return fail("conflicting visible stock statement");
  return { status: "available", ticketsUrl: TOLMINATOR_PRODUCT,
    excerpt: `${title}; ordinary admission Offer availability=In stock; valid sale window; visible product and price corroborate. Seller dates are NOT festival dates.` };
}
