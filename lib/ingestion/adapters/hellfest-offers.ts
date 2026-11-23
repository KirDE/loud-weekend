import { load } from "cheerio";
import type { TicketOfferProposal, TicketOfferProposalBatch } from "../../domain/ticket-offer-proposal.ts";

export const HELLFEST_OFFER_SOURCE = "https://hellfest.fr/";
export const HELLFEST_OFFER_PARSER = "hellfest-offer-proposals-v1";
const festivalSlug = "hellfest";

export function isHellfestOfferTarget(slug: string, officialUrl: string | null) {
  return slug === festivalSlug && officialUrl === HELLFEST_OFFER_SOURCE;
}
const compact = (value: string) => value.replace(/\s+/g, " ").trim();

/** Independent review-only extraction. Not registered with the ingestion runner.
 * Caller supplies the actual final response URL/status; no fetching, publication,
 * global ticket state, resale stock or checkout/fee inference happens here.
 */
export function extractHellfestOfferProposals(input: {
  html: string; finalUrl: string; status: number; editionYear: number; observedAt: string;
}): TicketOfferProposalBatch {
  const result: TicketOfferProposalBatch = { festivalSlug, editionYear: input.editionYear,
    sourceUrl: HELLFEST_OFFER_SOURCE, observedAt: input.observedAt, offers: [], warnings: [] };
  const fail = (message: string) => { result.warnings.push(message); return result; };
  if (input.status !== 200 || input.finalUrl !== HELLFEST_OFFER_SOURCE) return fail("Hellfest official response identity/status mismatch");
  if (!Number.isInteger(input.editionYear) || input.editionYear < 2000 || input.editionYear > 2100 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.observedAt) ||
      !Number.isFinite(Date.parse(input.observedAt)) || new Date(input.observedAt).toISOString() !== input.observedAt) {
    return fail("Hellfest edition or observation timestamp invalid");
  }
  if (Buffer.byteLength(input.html) > 2_000_000) return fail("Hellfest document exceeds bounded size");
  const $ = load(input.html);
  $("script,style,template,noscript,nav,aside,footer,[hidden],[inert],[aria-hidden='true']").remove();
  $("[style]").each((_, el) => {
    if (/display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\s|;|$)/i.test($(el).attr("style") ?? "")) $(el).remove();
  });
  const title = compact($("title").text());
  const identity = title.match(/^Hellfest \| (\d{1,2}) > (\d{1,2}) Juin (20\d{2}) \| Clisson - France$/);
  if ($("title").length !== 1 || !identity || Number(identity[3]) !== input.editionYear ||
      Number(identity[1]) < 1 || Number(identity[2]) > 30 || Number(identity[1]) > Number(identity[2])) {
    return fail("Hellfest current edition identity missing or unsupported");
  }
  const date = new RegExp(`^${identity[1]}\\s*-\\s*${identity[2]} juin ${input.editionYear}$`, "i");
  if (!$("h2").toArray().some(el => date.test(compact($(el).text())))) return fail("Hellfest visible edition dates missing");
  const containers = $(".home__tickets-cards");
  const cards = containers.children(".home__ticket-card");
  if (containers.length !== 1 || cards.length !== 2 || $(".home__ticket-card").length !== 2) return fail("Hellfest ordinary tier structure changed");
  const offers: TicketOfferProposal[] = [];
  for (const el of cards.toArray()) {
    const card = $(el);
    const one = (selector: string) => card.find(selector).length === 1;
    if (![".home__ticket-card-content", ".home__ticket-card-title", ".home__ticket-card-price", ".home__ticket-card-date", ".home__ticket-card-banner"].every(one)) {
      return fail("Hellfest tier fields missing or ambiguous");
    }
    const label = compact(card.find(".home__ticket-card-title").text());
    const kind = label === "Pass 4 jours" ? "full_pass" : label === "Pass 1 jour" ? "day_pass" : undefined;
    if (!kind || offers.some(o => o.kind === kind)) return fail("Hellfest ordinary tier identity changed");
    // Do not borrow a status/price from another card or guess availability from a link.
    const banner = card.find(".home__ticket-card-banner");
    const sold = banner.hasClass("home__ticket-card-soldout");
    const coming = banner.hasClass("home__ticket-card-comingsoon");
    const statusText = compact(banner.text()).toLowerCase();
    let status: TicketOfferProposal["status"];
    if (sold && !coming && statusText === "complet") status = "sold_out";
    else if (coming && !sold && statusText === "à venir") status = "not_on_sale";
    else return fail("Hellfest tier status changed or conflicts");
    const priceText = compact(card.find(".home__ticket-card-price").text());
    let price: TicketOfferProposal["price"] = null;
    const amount = priceText.match(/^(\d{1,5})(?:[,.](\d{2}))?\s*€$/);
    if (amount) price = { amountMinor: Number(amount[1]) * 100 + Number(amount[2] ?? 0), currency: "EUR", fees: "unknown" };
    else if (priceText.toLowerCase() !== "à venir") return fail("Hellfest tier price unsupported");
    const saleDateText = compact(card.find(".home__ticket-card-date").text()) || null;
    if ((saleDateText?.length ?? 0) > 120) return fail("Hellfest sale date text exceeds bounds");
    offers.push({ key: `${festivalSlug}-${input.editionYear}-${kind}`, kind, label, status, price, saleDateText,
      sourceUrl: HELLFEST_OFFER_SOURCE, observedAt: input.observedAt, excerpt: compact(card.text()).slice(0, 500) });
  }
  result.offers = offers;
  return result;
}
