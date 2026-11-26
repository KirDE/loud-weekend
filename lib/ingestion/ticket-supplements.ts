import {
  PROVINSSI_STOCK,
  fetchProvinssiStock,
  PROVINSSI_SCOPE,
  PROVINSSI_PURCHASE,
  isProvinssiStockSource,
  observeProvinssiStock,
  provinssiStockPublication,
} from "./provinssi-ticket-stock.ts";
import {
  SUMMER_STOCK,
  fetchSummerStock,
  SUMMER_SCOPE,
  SUMMER_PURCHASE,
  isSummerStockSource,
  observeSummerStock,
  summerStockPublication,
} from "./summer-ticket-stock.ts";
import {
  extractSwedenRockCandidate,
  swedenRockTicketSupplementUrl,
} from "./adapters/sweden-rock.ts";
import { renderedTicketText } from "./rendered-ticket-text.ts";
import { RFP_STOCK, RFP_PURCHASE, observeRfpStock } from "./rfp-ticket-stock.ts";
import { observeIdaysTicketStock } from "./adapters/idays.ts";
import { load } from "cheerio";
import type { FestivalSource, FestivalCandidate, IngestionResult } from "./types.ts";
import {
  HEAVY_STOCK,
  HEAVY_PURCHASE,
  fetchHeavyStockDocument,
  isHeavyStockSource,
  observeHeavyStock,
} from "./heavy-ticket-stock.ts";
import {
  VAINSTREAM_STOCK,
  isVainstreamStockSource,
  observeVainstreamStock,
} from "./vainstream-ticket-stock.ts";
import {
  ALCATRAZ_STOCK,
  ALCATRAZ_PURCHASE,
  isAlcatrazStockSource,
  observeAlcatrazStock,
} from "./alcatraz-ticket-stock.ts";

import { observeRemainingTicket, remainingTicketUrl } from "./remaining-ticket-stock.ts";

export const TICKET_SUPPLEMENT = "official-ticket-supplement-v1";
type TicketState = NonNullable<FestivalCandidate["ticketStatus"]>;
export type TicketObservation = {
  status?: TicketState;
  excerpt: string;
  warning?: string;
  ticketsUrl?: string;
  corroboratePrimaryPurchaseLink?: true;
};

export type TicketPublicationPolicy = {
  requiredFields: readonly string[];
  validatePrimary?: (input: {
    result: IngestionResult;
    requestedUrl: string;
    candidateSlug: string;
    stored: FestivalCandidate;
    evidence: readonly { field: string; sourceUrl: string; observedValue: unknown }[];
    edition: { year: number; startDate: string | null; endDate: string | null };
  }) => { markPartial: boolean; deferPlaylistRefreshFor?: string };
};

const ticketPublicationPolicies = new Map<string, TicketPublicationPolicy>([
  ["provinssi", provinssiStockPublication],
  ["summer-punch", summerStockPublication],
]);

export function ticketPublicationPolicy(festivalSlug: string): TicketPublicationPolicy | undefined {
  return ticketPublicationPolicies.get(festivalSlug);
}

type TicketAcquisition = (transport: {
  fetchWithRetry: (url: string, headers: Record<string, string>) => Promise<Response>;
  fetchOnce: typeof fetch;
  readText: (response: Response) => Promise<string>;
}) => Promise<{ response: Response } | { html: string }>;

function acquireWithCountedTransport(
  collector: (fetchImpl: typeof fetch) => Promise<{ html: string }>,
): TicketAcquisition {
  return async ({ fetchOnce }) => {
    try {
      const { html } = await collector(fetchOnce);
      return { html };
    } catch (error) {
      // fetchOnce already counts each request; don't propagate the collector's local total.
      if (!(error instanceof Error)) throw error;
      throw new Error(error.message, { cause: error });
    }
  };
}

const ticketAcquisitions = new Map<string, TicketAcquisition>([
  [HEAVY_STOCK, fetchHeavyStockDocument],
  [PROVINSSI_STOCK, acquireWithCountedTransport(fetchProvinssiStock)],
  [SUMMER_STOCK, acquireWithCountedTransport(fetchSummerStock)],
]);

export function ticketSupplementAcquisition(url: string): TicketAcquisition | undefined {
  return ticketAcquisitions.get(url);
}

/** A same-document response or a source adapter's reviewed canonical homepage. */
export function matchesTicketPrimaryUrl(source: FestivalSource, finalUrl: string): boolean {
  return (
    !finalUrl ||
    finalUrl === source.url ||
    (source.festivalSlug === "wacken-open-air" &&
      source.url === "https://www.wacken.com/" &&
      finalUrl === "https://www.wacken.com/de/")
  );
}

/** Reviewed source routes, not URLs supplied by arbitrary markup or API clients. */
export function ticketSupplementUrl(source: FestivalSource): string | undefined {
  if (source.fetchUrl || source.followLinkPattern || source.strategies.includes("manual_review"))
    return;
  const swedenRock = swedenRockTicketSupplementUrl(source);
  if (swedenRock) return swedenRock;
  const remaining = remainingTicketUrl(source);
  if (remaining) return remaining;
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return;
  if (isProvinssiStockSource(source)) return PROVINSSI_STOCK;
  if (isSummerStockSource(source)) return SUMMER_STOCK;
  if (isHeavyStockSource(source)) return HEAVY_STOCK;
  if (isVainstreamStockSource(source)) return VAINSTREAM_STOCK;
  if (isAlcatrazStockSource(source)) return ALCATRAZ_STOCK;
  if (
    source.festivalSlug === "rock-for-people" &&
    source.editionYear === 2027 &&
    url.href === "https://rockforpeople.cz/" &&
    source.strategies.includes("official_markup")
  )
    return RFP_STOCK;
  if (
    source.festivalSlug === "full-rewind" &&
    url.href === "https://full-rewind.de/" &&
    source.strategies.includes("official_markup") &&
    Number.isInteger(source.editionYear) &&
    source.editionYear >= 2027 &&
    source.editionYear <= 2100
  )
    return (
      "https://full-rewind.de/products/full-rewind-weekend-ticket-" + source.editionYear + ".js"
    );
  if (
    source.festivalSlug === "idays" &&
    url.hostname === "www.idays.it" &&
    ["/", "/line-up"].includes(url.pathname) &&
    source.strategies.includes("html_fallback")
  )
    return "https://www.idays.it/tickets";
  if (
    source.festivalSlug === "download" &&
    url.hostname === "downloadfestival.co.uk" &&
    url.pathname === "/"
  )
    return "https://downloadfestival.co.uk/tickets/";
  if (
    ["rock-am-ring", "rock-im-park"].includes(source.festivalSlug) &&
    url.hostname === `www.${source.festivalSlug}.com` &&
    url.pathname === "/"
  )
    return `https://www.${source.festivalSlug}.com/en/tickets`;
  if (
    source.festivalSlug === "wacken-open-air" &&
    url.hostname === "www.wacken.com" &&
    url.pathname === "/"
  )
    return `https://www.wacken.com/de/tickets-shop/ticket-uebersicht-${source.editionYear}/`;
  if (
    source.festivalSlug === "motocultor" &&
    url.hostname === "www.motocultor-festival.com" &&
    ["/", "/actualites/"].includes(url.pathname)
  )
    return "https://www.motocultor-festival.com/";
}

/** Human purchase destination can differ from the machine-readable stock URL. */
export function ticketSupplementPurchaseUrl(source: FestivalSource): string | undefined {
  const stockUrl = ticketSupplementUrl(source);
  if (!stockUrl) return;
  if (stockUrl === PROVINSSI_STOCK) return PROVINSSI_PURCHASE;
  if (stockUrl === SUMMER_STOCK) return SUMMER_PURCHASE;
  if (stockUrl === HEAVY_STOCK) return HEAVY_PURCHASE;
  if (stockUrl === ALCATRAZ_STOCK) return ALCATRAZ_PURCHASE;
  if (stockUrl === RFP_STOCK) return RFP_PURCHASE;
  return source.festivalSlug === "full-rewind"
    ? `https://full-rewind.de/collections/tickets-${source.editionYear}`
    : stockUrl;
}

/** Shared POST endpoints need explicit independently reconstructed event/rate scope. */
export function ticketSupplementScope(
  source: FestivalSource,
): { namespace: string; productId: string } | undefined {
  if (ticketSupplementUrl(source) === PROVINSSI_STOCK) return { ...PROVINSSI_SCOPE };
  return ticketSupplementUrl(source) === SUMMER_STOCK ? { ...SUMMER_SCOPE } : undefined;
}

export function isTicketSupplementUrl(source: FestivalSource, actual: string): boolean {
  return actual === ticketSupplementUrl(source);
}

export function observeTicketSupplement(
  html: string,
  source: FestivalSource,
  url: string,
  dates?: Partial<Pick<FestivalCandidate, "startDate" | "endDate" | "observedEditionYears">> & {
    fetchedAt?: string;
  },
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official ${source.festivalSlug} ticket source requires review: ${reason}`,
  });
  if (!isTicketSupplementUrl(source, url) || html.length > 2_000_000)
    return fail("source identity or size changed");
  if (swedenRockTicketSupplementUrl(source)) {
    const ticket = extractSwedenRockCandidate(
      html,
      { ...source, url },
      dates?.fetchedAt ?? new Date().toISOString(),
    );
    const evidence = ticket.evidence.find((entry) => entry.field === "ticketStatus");
    if (!ticket.ticketStatus || !evidence?.excerpt || ticket.warnings.length)
      return fail(ticket.warnings.join("; ") || "current ordinary-admission evidence absent");
    return { status: ticket.ticketStatus, ticketsUrl: url, excerpt: evidence.excerpt };
  }
  if (source.festivalSlug === "idays") return observeIdaysTicketStock(html, source.editionYear);
  if (url === PROVINSSI_STOCK) return observeProvinssiStock(html, dates);
  if (url === SUMMER_STOCK) return observeSummerStock(html, dates);
  if (source.festivalSlug === "rock-for-people")
    return observeRfpStock(html, source.editionYear, dates);
  if (source.festivalSlug === "full-rewind") {
    const year = source.editionYear;
    try {
      const product = JSON.parse(html);
      const title = "Full Rewind Weekend Ticket " + year,
        handle = "full-rewind-weekend-ticket-" + year;
      if (
        !product ||
        product.title !== title ||
        product.handle !== handle ||
        product.url !== "/products/" + handle ||
        product.vendor !== "Full Rewind" ||
        product.requires_selling_plan !== false ||
        typeof product.available !== "boolean" ||
        !Number.isSafeInteger(product.price) ||
        product.price <= 0 ||
        typeof product.description !== "string" ||
        !Array.isArray(product.variants) ||
        product.variants.length !== 1
      )
        return fail("standard weekend product identity or schema changed");
      const $product = load(product.description);
      $product("script, style, template, [hidden], [aria-hidden='true']").remove();
      const description = $product("p").first().text().replace(/\s+/g, " ").trim();
      const range = description.match(
        new RegExp(
          "^Full Rewind \\((\\d{1,2})\\.\\s*-\\s*(\\d{1,2})\\.(\\d{2})\\.(20\\d{2" +
            "})\\) Weekend Ticket beinhaltet ein Weekend Ticket inkl\\. Cam" +
            "ping\\.",
          "",
        ),
      );
      if (!range || Number(range[4]) !== year)
        return fail("weekend admission edition/dates absent");
      const iso = (day: string) => range[4] + "-" + range[3] + "-" + day.padStart(2, "0");
      const start = iso(range[1]),
        end = iso(range[2]);
      if (!dates?.startDate || !dates.endDate || start !== dates.startDate || end !== dates.endDate)
        return fail("weekend admission dates disagree with verified official festival dates");
      const variant = product.variants[0],
        quantity = variant?.quantity_rule;
      if (
        !variant ||
        variant.title !== "Default Title" ||
        variant.name !== title ||
        variant.sku !== "T-" + year + "-Weekend" ||
        typeof variant.available !== "boolean" ||
        variant.available !== product.available ||
        variant.requires_selling_plan !== false ||
        !Number.isSafeInteger(variant.price) ||
        variant.price <= 0 ||
        variant.price !== product.price ||
        !quantity ||
        quantity.min !== 1 ||
        quantity.increment !== 1 ||
        !(quantity.max === null || (Number.isSafeInteger(quantity.max) && quantity.max >= 1))
      )
        return fail("standard weekend variant inventory or quantity schema changed");
      // Shopify false means unavailable for purchase, not a confirmed global
      // sellout. Parking stock and shipping deadlines are not admission stock.
      return {
        status: product.available ? "available" : "unavailable",
        ticketsUrl: "https://full-rewind.de/collections/tickets-" + year,
        excerpt:
          title +
          "; " +
          start +
          "–" +
          end +
          "; official Shopify standard weekend variant available=" +
          product.available,
      };
    } catch {
      return fail("invalid public weekend product JSON");
    }
  }
  if (url === HEAVY_STOCK) return observeHeavyStock(html, dates);
  if (url === ALCATRAZ_STOCK) return observeAlcatrazStock(html, source.editionYear, dates);
  if (remainingTicketUrl(source)) return observeRemainingTicket(html, source, dates);
  if (url === VAINSTREAM_STOCK) return observeVainstreamStock(html, dates);
  const $ = load(html);
  const declaredEvents: Array<{
    name?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    eventStatus?: unknown;
  }> = [];
  if (source.festivalSlug === "download")
    $("script[type='application/ld+json']").each((_, element) => {
      try {
        const value = JSON.parse($(element).text());
        if (value && value["@type"] === "Event") declaredEvents.push(value);
      } catch {
        /* Missing or invalid edition evidence remains review-required. */
      }
    });
  // Like JSON-LD edition metadata, a decorative aria-hidden ticket stub is
  // identity metadata only. Stock still requires visible ordinary-pass controls.
  const motocultorEditions = new Map<object, { brand: string; year: string; dates: string }>();
  if (source.festivalSlug === "motocultor")
    $(".passes__list > .pass > .ticket").each((_, element) => {
      const stub = $(element).children(".ticket__stub");
      if (stub.length === 1)
        motocultorEditions.set(element, {
          brand: stub.children(".ticket__brand").text().trim(),
          year: stub.children(".ticket__year").text().trim(),
          dates: stub.children(".ticket__dates").text().replace(/\s+/g, " ").trim(),
        });
    });
  // Edition metadata above is not an inventory assertion. Ticket stock below
  // must come from the visible reviewed product structure, never generic text.
  $("script, style, noscript, template, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  const text = (value: string) => value.replace(/\s+/g, " ").trim();
  $("nav, footer").remove();
  const year = source.editionYear;
  if (source.festivalSlug === "motocultor") {
    if (
      !text($("title").text()).startsWith(`Motocultor Festival ${year} - `) ||
      $("link[rel='canonical']").length !== 1 ||
      $("link[rel='canonical']").attr("href") !== url
    )
      return fail("current official homepage identity absent");
    const cards = $(".passes__list > .pass > .ticket").filter(
      (_, card) => text($(card).children(".ticket__main").children("h3").text()) === "Pass 4 jours",
    );
    if (cards.length !== 1) return fail("ordinary four-day pass absent or duplicated");
    const card = cards.first(),
      metadata = motocultorEditions.get(card[0]);
    const dates = (metadata?.dates ?? "").match(
      new RegExp(`^(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+août\\s+${year}$`),
    );
    if (
      metadata?.brand !== "Motocultor Festival" ||
      metadata?.year !== String(year) ||
      !dates ||
      Number(dates[2]) - Number(dates[1]) !== 3 ||
      Number(dates[1]) < 1 ||
      Number(dates[2]) > 31
    )
      return fail("four-day admission edition absent or conflicting");
    const main = card.children(".ticket__main");
    const regular = main
      .find(".tiers > .tier")
      .filter((_, tier) => text($(tier).children(".tier__label").text()) === "Tarif normal");
    if (regular.length !== 1) return fail("regular price tier absent or duplicated");
    const tier = regular.first();
    const disabled = "[disabled], [aria-disabled='true'], .disabled, .is-disabled";
    const state = tier.children(".tier__state");
    const price = tier.children(".tier__price");
    const buy = main.children("a.ticket__cta[href]").filter((_, anchor) => {
      const link = $(anchor);
      try {
        const target = new URL(link.attr("href")!);
        return (
          target.protocol === "https:" &&
          target.hostname === "feverup.com" &&
          !target.username &&
          !target.password &&
          !target.port &&
          !target.hash &&
          /^\/m\/\d+$/.test(target.pathname) &&
          text(link.text()) === "Prendre mon pass" &&
          link.closest(disabled).length === 0
        );
      } catch {
        return false;
      }
    });
    if (
      tier.hasClass("tier--on-sale") &&
      !tier.hasClass("tier--sold-out") &&
      state.length === 1 &&
      price.length === 1 &&
      !state.closest(disabled).length &&
      !price.closest(disabled).length &&
      !state.find(disabled).length &&
      !price.find(disabled).length &&
      text(state.text()) === "En vente" &&
      buy.length === 1 &&
      /^\d+(?:[.,]\d+)?\s*€$/.test(text(price.text()))
    )
      return {
        status: "available",
        excerpt:
          `Motocultor Festival ${year}; Pass 4 jours; Tarif normal; ` +
          `${text(price.text())}; En vente; enabled official Fever Prendre mon pass control`,
      };
    // Sold-out early-bird tiers and unknown day-pass inventory do not prove
    // whole-event sellout. Keep the last-good snapshot on any unsupported state.
    return fail("no unambiguous on-sale regular four-day admission");
  }
  if (["rock-am-ring", "rock-im-park"].includes(source.festivalSlug)) {
    const name = source.festivalSlug === "rock-am-ring" ? "Rock am Ring" : "Rock im Park";
    const title = text($("title").text());
    if (
      !title.startsWith(`${name} | `) ||
      !new RegExp(`\\b${year}\\b`).test(title) ||
      $("link[rel='canonical']").length !== 1 ||
      $("link[rel='canonical']").attr("href") !== url ||
      text($("h1").text()) !== "Tickets"
    )
      return fail("current ticket-page identity absent");
    const headings = $("h2").filter((_, element) => text($(element).text()) === "Festival tickets");
    if (headings.length !== 1) return fail("ordinary admission group absent or ambiguous");
    const expected =
      source.festivalSlug === "rock-am-ring"
        ? ["Festival Ticket"]
        : ["FESTIVAL TICKET – GENERAL CAMPING", "FESTIVAL TICKET – GREEN CAMPING"];
    const cards = headings
      .parent()
      .children(".ticketitem-block")
      .filter((_, element) =>
        expected.includes(text($(element).children(".header").children(".title").text())),
      );
    const titles = cards
      .map((_, element) => text($(element).children(".header").children(".title").text()))
      .get();
    if (cards.length !== expected.length || new Set(titles).size !== expected.length)
      return fail("standard admission card absent or duplicated");
    let available: string | undefined;
    for (const element of cards.toArray()) {
      const card = $(element),
        header = card.children(".header");
      const description = text(card.children(".footer").children(".footer-content").text());
      if (
        !/valid (?:for|on) all three (?:event days|days of the event)/i.test(description) ||
        !new RegExp(`\\b${year}\\b`).test(description) ||
        /\b20\d{2}\b/g.test(description.replaceAll(String(year), ""))
      )
        return fail("ordinary admission product edition absent or conflicting");
      const buy = header
        .children(".ctas")
        .find("a.btn-cta[href]")
        .filter((_, anchor) => {
          const link = $(anchor);
          try {
            const target = new URL(link.attr("href")!);
            return (
              target.protocol === "https:" &&
              target.hostname === "www.eventim.de" &&
              !target.username &&
              !target.password &&
              !target.port &&
              !target.hash &&
              /^\/noapp\/event\/\d+\/$/.test(target.pathname) &&
              text(link.text()) === "Buy now" &&
              link.closest("[disabled], [aria-disabled='true'], .disabled, .is-disabled").length ===
                0
            );
          } catch {
            return false;
          }
        });
      const sold = /(?:sold out|ausverkauft)\b/i.test(renderedTicketText(card));
      if (buy.length > 1 || (sold && buy.length))
        return fail("conflicting ordinary admission inventory");
      if (buy.length === 1 && !sold) available = text(header.children(".title").text());
    }
    if (available)
      return {
        status: "available",
        excerpt: `${name} ${year}; ordinary three-day admission ${available}; enabled official Eventim Buy now control`,
      };
    // Hotel bundles or other admission may remain: do not infer global sellout.
    return fail("no verified purchasable ordinary admission; whole-event sellout not established");
  }
  if (source.festivalSlug === "wacken-open-air") {
    if (!new RegExp(`Ticket.*${year}`).test($("title").text()))
      return fail("current edition title absent");
    const cards = $(".wt-card").filter(
      (_, card) => text($(card).find(".wt-card__name").text()) === "Louder",
    );
    if (cards.length !== 1) return fail("standard festival-pass card absent or ambiguous");
    const card = cards.first(),
      statement = text(card.text());
    if (
      !new RegExp(`Wacken Open Air ${year}\\b`, "i").test(statement) ||
      !/Festivalpass/i.test(statement)
    )
      return fail("standard pass edition unverified");
    const buy = card.find("a.wt-card__btn").filter((_, anchor) => {
      const link = $(anchor);
      return (
        link.attr("href") ===
          `https://ticketstore.wacken.com/de/wacken-open-air-${year}/4-day-tickets` &&
        !link.is("[disabled], [aria-disabled='true']") &&
        /Louder Ticket kaufen/i.test(text(link.text()))
      );
    });
    const soldOut =
      card.hasClass("wt-card--soldout") &&
      /^(?:Sold Out|Ausverkauft)$/i.test(text(card.find(".wt-card__badge").text()));
    if (soldOut && buy.length) return fail("conflicting standard-pass stock and purchase evidence");
    if (soldOut)
      return {
        status: "sold_out",
        excerpt: `Wacken Open Air ${year}; standard Louder festival pass; ${text(card.find(".wt-card__badge").text())}`,
      };
    if (buy.length === 1 && /^€\s*\d+(?:[.,]\d+)?$/.test(text(card.find(".wt-card__price").text())))
      return {
        status: "available",
        excerpt:
          "Wacken Open Air " +
          `${year}` +
          "; standard Louder festival pass; " +
          `${text(buy.text())}` +
          "; " +
          `${text(card.find(".wt-card__price").text())}`,
      };
    return fail("no verified standard-pass inventory");
  }
  if (source.festivalSlug === "download") {
    const event = declaredEvents.length === 1 ? declaredEvents[0] : undefined;
    if (
      !event ||
      event.name !== "Download Festival" ||
      typeof event.startDate !== "string" ||
      typeof event.endDate !== "string" ||
      !event.startDate.startsWith(`${year}-`) ||
      !event.endDate.startsWith(`${year}-`) ||
      !Number.isFinite(Date.parse(event.startDate)) ||
      !Number.isFinite(Date.parse(event.endDate)) ||
      event.startDate >= event.endDate ||
      (event.eventStatus && event.eventStatus !== "https://schema.org/EventScheduled") ||
      !/^Download Festival \| Tickets$/.test(text($("title").text()))
    )
      return fail("current festival ticket page identity absent");
    const regular = $(".tg").filter((_, group) =>
      ["General Camping", "Weekend Arena Only"].includes(
        text($(group).children(".group-title").text()),
      ),
    );
    if (regular.length !== 2) return fail("regular admission groups absent or duplicated");
    const cards = regular.find(".ticket-card");
    const expected = new Set(["5 Nights", "3 Nights", "Weekend Arena Only"]);
    const titles = cards.map((_, card) => text($(card).find(".t-title").text())).get();
    if (
      cards.length !== 3 ||
      new Set(titles).size !== 3 ||
      titles.some((title) => !expected.has(title))
    )
      return fail("regular admission product schema changed");
    let available: string | undefined;
    for (const element of cards.toArray()) {
      const card = $(element),
        title = text(card.find(".t-title").text());
      const purchase = card.find("a[href]").filter((_, anchor) => {
        const link = $(anchor);
        try {
          const target = new URL(link.attr("href") ?? "");
          return (
            target.protocol === "https:" &&
            target.hostname === "www.ticketmaster.co.uk" &&
            !target.username &&
            !target.password &&
            !target.port &&
            /^\/event\/[A-Za-z0-9]+$/.test(target.pathname) &&
            !link.is("[disabled], [aria-disabled='true']") &&
            text(link.text()).startsWith(`Buy Now: ${title}`)
          );
        } catch {
          return false;
        }
      });
      const sold = card.hasClass("so") && /^Sold Out$/i.test(text(card.find(".swash").text()));
      if (sold && purchase.length) return fail("conflicting product stock and purchase evidence");
      if (purchase.length > 1) return fail("ambiguous product purchase destination");
      if (!sold && purchase.length === 1) available = title;
    }
    if (available)
      return {
        status: "available",
        excerpt:
          "Download Festival " +
          `${year}` +
          "; regular admission " +
          `${available}` +
          "; enabled official Ticketmaster Buy Now control",
      };
    // Other categories can still include entry; three sold-out regular products
    // are not proof that the whole festival or every ticket type has sold out.
    return fail("no verified purchasable regular admission; whole-event sellout not established");
  }
  return fail("no reviewed ticket adapter");
}
