import { z } from "zod";
import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";
// The audited route identifies which public product to observe, not its stock.
export const VAINSTREAM_STOCK =
  "https://www.vainstream-shop.de/2027-tickets/10636/regular-festivalticket?c=2423";
const edition = 2027;

export function isVainstreamStockSource(source: FestivalSource): boolean {
  return (
    source.festivalSlug === "vainstream" &&
    source.url === "https://vainstream.com/artists/" &&
    source.editionYear === edition &&
    source.strategies.includes("official_markup") &&
    !source.fetchUrl &&
    !source.followLinkPattern &&
    !source.strategies.includes("manual_review")
  );
}

const day = z.iso.date();

export function observeVainstreamStock(
  body: string,
  dates?: Pick<FestivalCandidate, "startDate" | "endDate">,
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official vainstream ticket source requires review: ${reason}`,
  });
  const primary = z.object({ startDate: day, endDate: day }).safeParse(dates);
  if (
    !primary.success ||
    !primary.data.startDate.startsWith(`${edition}-`) ||
    !primary.data.endDate.startsWith(`${edition}-`) ||
    Date.parse(primary.data.endDate) - Date.parse(primary.data.startDate) !== 86_400_000
  )
    return fail("verified current primary festival dates absent");
  const $ = load(body),
    text = (s: string) => s.replace(/\s+/g, " ").trim();
  $("script,style,noscript,template,[hidden],[inert],[aria-hidden='true']").remove();
  $("[style]").each((_, e) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(e).attr("style") ?? "")) $(e).remove();
  });
  if (
    $("title").length !== 1 ||
    text($("title").text()) !==
      `Festivalticket ${edition}- Regular | Official Vainstream Shop | Official Vainstream Shop`
  )
    return fail("current ordinary product page title changed");
  const products = $(".product--details[itemtype='https://schema.org/Product']");
  if (products.length !== 1) return fail("ordinary product missing or ambiguous");
  const p = products.first();
  const productIds = p.find("meta[itemprop='productID']"),
    skus = p.find("[itemprop='sku']");
  const productId = productIds.attr("content") ?? "",
    sku = text(skus.text());
  if (
    productIds.length !== 1 ||
    !/^[1-9]\d{0,11}$/.test(productId) ||
    skus.length !== 1 ||
    !/^VS-TI-[0-9]{4,8}$/.test(sku) ||
    p.find("h1.product--title").length !== 1 ||
    text(p.find("h1.product--title").text()) !== "Regular Festivalticket"
  )
    return fail("ordinary physical festival ticket identity changed");
  const offers = p.find(".buybox--inner[itemprop='offers'][itemtype='https://schema.org/Offer']");
  if (offers.length !== 1) return fail("selected product offer missing or ambiguous");
  const offer = offers.first(),
    price = offer.find("meta[itemprop='price']").attr("content"),
    currencies = offer.find("meta[itemprop='priceCurrency']");
  if (
    offer.find("meta[itemprop='price']").length !== 1 ||
    currencies.length !== 1 ||
    currencies.attr("content") !== "EUR" ||
    !price ||
    !/^\d+(?:\.\d{2})?$/.test(price) ||
    !Number.isFinite(Number(price)) ||
    Number(price) <= 0
  )
    return fail("ordinary offer currency/price schema changed");
  const availability = offer.find("[itemprop='availability']");
  if (availability.length !== 1 || availability.attr("href") !== "https://schema.org/InStock")
    return fail("ordinary physical admission not in stock; other admission is unknown");
  const form = offer.find("form.buybox--form"),
    quantity = form.find("select[name='sQuantity']"),
    buy = form.find("button.buybox--button");
  const blocked =
    "[disabled],[aria-disabled='true'],[hidden],[inert],.is--disabled,.is--sold-out,.is--hidden";
  if (
    form.length !== 1 ||
    form.attr("method")?.toLowerCase() !== "post" ||
    form.attr("action") !== "https://www.vainstream-shop.de/checkout/addArticle" ||
    form.find("input[name='sAdd']").length !== 1 ||
    form.find("input[name='sAdd']").attr("value") !== sku ||
    quantity.length !== 1 ||
    !quantity.find("option[value='1']:not([disabled])").length ||
    buy.length !== 1 ||
    text(buy.text()) !== "In den Warenkorb" ||
    [offer, form, quantity, buy].some((el) => el.is(blocked) || el.parents(blocked).length > 0) ||
    /ausverkauft|nicht\s+(?:mehr\s+)?(?:verfügbar|lieferbar)|nicht\s+auf\s+lager/i.test(
      text(offer.text()),
    )
  )
    return fail("ordinary stock and enabled purchase controls absent or contradictory");
  return {
    status: "available",
    ticketsUrl: VAINSTREAM_STOCK,
    excerpt:
      `Vainstream ${edition}; Regular Festivalticket; product ${productId} / ${sku}; EUR ${price}; ` +
      "schema.org/InStock plus enabled ordinary quantity/buy controls (not shipping time, VIP or early-bird stock)",
  };
}
