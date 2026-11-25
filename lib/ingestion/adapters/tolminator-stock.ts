import { load } from "cheerio";
import { z } from "zod";
import type { TicketObservation } from "../ticket-supplements.ts";

// Reviewed ordinary admission product, not the listing, camping or an upgrade.
// Deliberately edition-specific: a future product needs a new reviewed identity.
export const TOLMINATOR_PRODUCT =
  "https://tolminator.mojekarte.si/si/" +
  "tolminator-2027-festivalska-vstopnica-predprodaja-1-210-eur/vstopnice-1235366.html";
const stockEdition = 2027;

export function isTolminatorStockRoute(url: string | null | undefined): boolean {
  return url === TOLMINATOR_PRODUCT;
}

export function matchesTolminatorStockEdition(slug: string, years: readonly number[]): boolean {
  return slug === "tolminator" && years.length === 1 && years[0] === stockEdition;
}

const purchaseAction = "https://tolminator.mojekarte.si/si/basket/add/1235366";
const timestamp = z.iso.datetime({ offset: true });
const ordinaryTitle =
  /^TOLMINATOR (20\d{2}) FESTIVALSKA VSTOPNICA - PREDPRODAJA [1-9]\d* - ([1-9]\d{0,5})(?:[,.](\d{2}))? EUR$/;
const money = (amount: string) => Number(amount.replace(",", ".")).toFixed(2);
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Pure stock observation only. Never requests the action URL, publishes dates,
 * price/fees or infers inventory from the visible price/buy control alone.
 * Transport and canonical persisted-proof integration remain separate gates. */
export function observeTolminatorStock(
  html: string,
  url: string,
  year: number,
  observedAt: string,
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official tolminator ticket source requires review: ${reason}`,
  });
  const now = Date.parse(observedAt);
  if (
    !isTolminatorStockRoute(url) ||
    year !== stockEdition ||
    !Number.isFinite(now) ||
    Buffer.byteLength(html, "utf8") > 2_000_000
  )
    return fail("source, edition, time or size changed");
  const $ = load(html);
  // Remove hidden containers before metadata extraction too: hidden Event nodes
  // cannot corroborate visible ordinary admission, including hidden ancestors.
  $("style, noscript, template, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  const events: Record<string, any>[] = [];
  let invalidJson = false;
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const document = JSON.parse($(element).text());
      if (!document || !Array.isArray(document["@graph"]) || document["@graph"].length > 100) {
        invalidJson = true;
        return;
      }
      for (const node of document["@graph"]) {
        if (node?.["@type"] === "Event") events.push(node);
      }
    } catch {
      invalidJson = true;
    }
  });
  if (invalidJson || events.length !== 1) return fail("unique valid Event metadata absent");
  const event = events[0],
    aggregate = event.offers;
  const title = typeof event.name === "string" ? normalize(event.name) : "";
  const ordinary = ordinaryTitle.exec(title);
  const start = timestamp.safeParse(event.startDate),
    end = timestamp.safeParse(event.endDate);
  if (
    !ordinary ||
    Number(ordinary[1]) !== year ||
    event.url !== url ||
    !start.success ||
    !end.success ||
    !start.data.startsWith(`${year}-`) ||
    !end.data.startsWith(`${year}-`) ||
    Date.parse(end.data) <= Date.parse(start.data) ||
    Date.parse(end.data) <= now ||
    (event.eventStatus !== undefined &&
      !["EventScheduled", "https://schema.org/EventScheduled"].includes(event.eventStatus)) ||
    aggregate?.["@type"] !== "AggregateOffer" ||
    aggregate.offerCount !== 1 ||
    aggregate.priceCurrency !== "EUR" ||
    !Array.isArray(aggregate.offers) ||
    aggregate.offers.length !== 1
  )
    return fail("ordinary product identity or offer schema changed");
  const offer = aggregate.offers[0];
  const price = offer?.price;
  const titlePrice = `${ordinary[2]}.${ordinary[3] ?? "00"}`;
  if (
    offer?.["@type"] !== "Offer" ||
    offer.name !== "Cena" ||
    offer.url !== purchaseAction ||
    typeof price !== "string" ||
    !/^[1-9]\d{0,5}(?:\.\d{2})?$/.test(price) ||
    money(price) !== titlePrice ||
    aggregate.lowPrice !== price ||
    aggregate.highPrice !== price ||
    offer.priceCurrency !== "EUR" ||
    offer.availability !== "In stock" ||
    !timestamp.safeParse(offer.validFrom).success ||
    !timestamp.safeParse(offer.validThrough).success ||
    Date.parse(offer.validFrom) > now ||
    Date.parse(offer.validThrough) <= now
  )
    return fail("explicit current ordinary inventory absent or conflicting");
  $("script, nav, footer").remove();
  const [date, time] = start.data.split("T");
  const [yyyy, mm, dd] = date.split("-");
  const pageTitle = `Vstopnice za ${title}, ${dd}.${mm}.${yyyy} ob ${time.slice(0, 5)} (si)`;
  const heading = $("h1.show-for-small-only"),
    prices = $(".description-prices-list");
  if (
    heading.length !== 1 ||
    normalize(heading.text()) !== title ||
    $("title").length !== 1 ||
    normalize($("title").text()) !== pageTitle ||
    prices.length !== 1 ||
    prices.find(".description-prices-item").length !== 1 ||
    normalize(prices.text()) !== `${titlePrice.replace(".", ",")} EUR Cena`
  )
    return fail("visible product identity or price differs");
  const buy = $("a.description-buy-link");
  if (
    buy.length !== 1 ||
    buy.attr("href") !== purchaseAction ||
    normalize(buy.text()) !== "Nakup vstopnic" ||
    buy.is("[disabled], [aria-disabled='true']") ||
    buy.parents("[disabled], [aria-disabled='true']").length
  )
    return fail("visible ordinary purchase control absent or disabled");
  if (/razprodano|ni na voljo|sold\s*out|off\s*sale/i.test($("body").text()))
    return fail("conflicting visible stock statement");
  return {
    status: "available",
    ticketsUrl: TOLMINATOR_PRODUCT,
    excerpt:
      `${title}; ordinary admission Offer availability=In stock; valid sale window; ` +
      "visible product and price corroborate. Seller dates are NOT festival dates.",
  };
}
