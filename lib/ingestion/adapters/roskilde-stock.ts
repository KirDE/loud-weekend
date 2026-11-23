import reviewedStock from "../config/roskilde-stock.json" with { type: "json" };
import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

export const ROSKILDE_STOCK_YEAR = reviewedStock.editionYear;
export const ROSKILDE_STOCK_INITIALIZATION = reviewedStock.initializationText;
export const ROSKILDE_STOCK_ROOT = `https://ticket.roskilde-festival.dk/da/${reviewedStock.shopKey}`;
export const ROSKILDE_PRODUCTS_URL = `${ROSKILDE_STOCK_ROOT}/products`;
export function isRoskildeStockRoute(url: string | null | undefined): boolean {
  return url === ROSKILDE_PRODUCTS_URL;
}

export function matchesRoskildeStockEdition(slug: string, years: readonly number[]): boolean {
  return slug === "roskilde" && years.length === 1 && years[0] === ROSKILDE_STOCK_YEAR;
}

export const ROSKILDE_STOCK_SOURCE: FestivalSource = {
  festivalSlug: "roskilde",
  url: ROSKILDE_PRODUCTS_URL,
  editionYear: ROSKILDE_STOCK_YEAR,
  strategies: ["official_markup"],
  refreshPolicy: "daily",
  enabled: false,
};
const clean = (text: string) => text.replace(/\s+/gu, " ").trim();
const fail = (): never => {
  throw new Error("Roskilde ordinary stock structure or availability not verified");
};

/** Observer only, not registered. Never selects quantities or returns raw shop
 * HTML, session state, prices, dates or inventory counts. A full-pass negative
 * is NOT festival-wide sold out: day tickets have independent stock.
 */
export function observeRoskildeStock(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
  transport: { status: number; finalUrl: string },
): FestivalCandidate {
  if (
    source.festivalSlug !== "roskilde" ||
    source.editionYear !== ROSKILDE_STOCK_YEAR ||
    source.url !== ROSKILDE_PRODUCTS_URL ||
    source.fetchUrl ||
    source.followLinkPattern ||
    source.headers ||
    transport.status !== 200 ||
    transport.finalUrl !== ROSKILDE_PRODUCTS_URL ||
    !/^\d{4}-\d{2}-\d{2}T/.test(fetchedAt) ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    new Date(fetchedAt).toISOString() !== fetchedAt ||
    !html ||
    Buffer.byteLength(html, "utf8") > 2_000_000
  )
    fail();
  const $ = load(html);
  if (clean($("title").text()) !== "Roskilde Festival - Tickster" || $("title").length !== 1)
    fail();
  $("script, style, template, noscript, [inert], [hidden], [aria-hidden='true']").remove();
  $("[style]").each((_, el) => {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\s*[;!]|$))/i.test(
        $(el).attr("style") ?? "",
      )
    )
      $(el).remove();
  });
  $(".hidden, .d-none, .u-hidden").remove();
  const table = $("section#ProductsTable");
  if (table.length !== 1) fail();
  const groups = table.children("article").filter((_, el) => {
    const heading = $(el).find("h3.ProductsNameCellProductName");
    return /^Partout(?: Udsolgt)?$/.test(clean(heading.text()));
  });
  if (groups.length !== 1) fail();
  const group = groups.first();
  if (group.find("h3.ProductsNameCellProductName").length !== 1) fail();
  const description = group.find("p.ProductsNameCellProductDescription");
  if (description.length !== 1 || clean(description.text()) !== reviewedStock.fullPassDescription)
    fail();
  if (
    clean(group.find("h3.ProductsNameCellProductName").text()) !== "Partout" ||
    /udsolgt|ikke til salg|not on sale|sold out/i.test(group.text())
  )
    fail();
  const variants = group.next();
  if (!variants.is("details")) fail();
  const ordinary = variants.children("article.POSVariantRow").filter((_, el) => {
    return /^Standard(?: Udsolgt)?$/.test(
      clean($(el).find("h3.ProductsNameCellProductName").text()),
    );
  });
  if (
    ordinary.length !== 1 ||
    ordinary.find("h3.ProductsNameCellProductName").length !== 1 ||
    clean(ordinary.find("h3.ProductsNameCellProductName").text()) !== "Standard"
  )
    fail();
  const ordinaryDescription = ordinary.find("p.ProductsNameCellProductDescription");
  if (
    ordinaryDescription.length !== 1 ||
    clean(ordinaryDescription.text()) !== "Fra 15 år og opefter." ||
    /udsolgt|sold out|ikke til salg|not on sale|venteliste|waitlist|donation|medlem|membership/i.test(
      ordinary.text(),
    )
  )
    fail();
  const select = ordinary.find("select");
  if (
    select.length !== 1 ||
    select.is(":disabled") ||
    select.attr("aria-disabled") === "true" ||
    select.parents("[aria-disabled='true'], [inert], fieldset[disabled]").length ||
    select.find("option").length < 2 ||
    select.find("option").length > 100
  )
    fail();
  const values = select
    .find("option")
    .toArray()
    .map((el) => {
      const option = $(el),
        value = option.attr("value") ?? "";
      if (!/^(?:0|[1-9]\d{0,2})$/.test(value)) fail();
      return {
        value: Number(value),
        usable:
          !option.is("[disabled], [aria-disabled='true']") &&
          !option.parents("optgroup[disabled]").length,
      };
    });
  if (
    new Set(values.map((v) => v.value)).size !== values.length ||
    !values.some((v) => v.value === 0) ||
    !values.some((v) => v.value > 0 && v.usable)
  )
    fail();
  // A fixed minimized assertion, not text copied from untrusted arbitrary fields.
  const excerpt =
    `${reviewedStock.eventName} ${ROSKILDE_STOCK_YEAR} / Partout / Standard (15+): ` +
    "enabled quantity selector with positive choices. " +
    "Ordinary full pass only; not inventory quantity or availability of all categories.";
  return {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    observedEditionYears: [ROSKILDE_STOCK_YEAR],
    warnings: [],
    ticketStatus: "available",
    ticketsUrl: ROSKILDE_PRODUCTS_URL,
    evidence: ["ticketStatus", "ticketsUrl"].map((field) => ({
      field: field as "ticketStatus" | "ticketsUrl",
      sourceUrl: source.url,
      observedAt: fetchedAt,
      excerpt,
    })),
  };
}
