import { load, type CheerioAPI } from "cheerio";
import { extractEurockeennesCandidate } from "./adapters/eurockeennes.ts";
import type { FestivalCandidate, FestivalSource } from "./types.ts";
import type { TicketObservation } from "./ticket-supplements.ts";

/** Fixed organizer routes, not edition facts or provider product identifiers. */
export function remainingTicketUrl(source: FestivalSource): string | undefined {
  if (source.festivalSlug === "pinkpop" && source.url === "https://www.pinkpop.nl/")
    return "https://www.pinkpop.nl/tickets/";
  if (source.festivalSlug === "eurockeennes" && source.url === "https://www.eurockeennes.fr/")
    return "https://www.eurockeennes.fr/achat/";
}

const text = (value: string) => value.replace(/\s+/g, " ").trim();
const disabled = "[disabled],[aria-disabled='true'],.disabled,.sold-out,.soldout";
function enabled($: CheerioAPI, node: Parameters<CheerioAPI>[0]) {
  const element = $(node);
  return !element.is(disabled) && !element.parents(disabled).length;
}

const negative =
  /sold\s*out|uitverkocht|épuisé|indisponible|bientôt|prochainement|not\s+(?:yet\s+)?(?:on sale|available)/i;
type Dates = Pick<FestivalCandidate, "startDate" | "endDate">;

export function observeRemainingTicket(
  html: string,
  source: FestivalSource,
  dates?: Dates,
): TicketObservation {
  const fail = (reason: string): TicketObservation => ({
    excerpt: "",
    warning: `Official ${source.festivalSlug} ticket source requires review: ${reason}`,
  });
  const year = source.editionYear;
  if (!dates?.startDate?.startsWith(`${year}-`) || !dates.endDate?.startsWith(`${year}-`))
    return fail("current organizer edition dates absent");

  const $ = load(html);
  $(
    "script,style,noscript,template,nav,footer,.hidden,.d-none,[hidden],[inert],[aria-hidden='true']",
  ).remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  const title = text($("title").text());

  if (source.festivalSlug === "pinkpop") {
    if (
      !new RegExp(`^Tickets [–—-] Pinkpop ${year}$`).test(title) ||
      text($("h1").text()) !== "Tickets"
    )
      return fail("current ticket page identity absent");
    const sale = new RegExp(`^De reguliere ticketverkoop voor Pinkpop ${year} is reeds gestart\\.`);
    const statements = $("p").filter((_, element) => {
      const copy = text($(element).text());
      return (
        sale.test(copy) &&
        copy.includes("Tickets zijn beschikbaar voor iedereen, zolang de voorraad strekt") &&
        !negative.test(copy)
      );
    });
    if (statements.length !== 1)
      return fail("current ordinary on-sale assertion absent or ambiguous");
    const cards = $("article.product").filter(
      (_, element) =>
        text($(element).find("h3").text()) === "Regulier" &&
        $(element).find(
          "[data-src='https://www.pinkpop.nl/tickets/festivaltickets-weekend-regulier/?ajax=1']",
        ).length > 0,
    );
    if (cards.length !== 1) return fail("ordinary weekend card absent or duplicated");
    const card = cards.first();
    const purchase = card
      .find("a.ticket")
      .filter(
        (_, element) =>
          enabled($, element) &&
          /^https:\/\/www\.ticketmaster\.nl\/event\/\d+$/.test($(element).attr("href") ?? "") &&
          text($(element).text()) === "Koop ticket",
      );
    const price = text(card.find(".price").text());
    if (
      !enabled($, card) ||
      negative.test(text(card.text())) ||
      purchase.length !== 1 ||
      !/^€\s*\d+(?:[.,]\d+)?$/.test(price) ||
      text(card.find(".summary").text()) !== "Toegang tot het festivalterrein en de Festivalcamping"
    )
      return fail("ordinary weekend stock/control missing or conflicting");
    return {
      status: "available",
      excerpt: `${title}; Regulier weekend; ${price}; ${text(statements.text())}; ${purchase.attr("href")}`,
    };
  }

  if (!title.startsWith("Billetterie | Les Eurockéennes de Belfort"))
    return fail("ticket page identity absent");
  const edition = extractEurockeennesCandidate($.html(), source, "");
  if (edition.startDate !== dates.startDate || edition.endDate !== dates.endDate)
    return fail("ticket page dates disagree with the organizer edition");
  // Cheerio text() merges words separated by a line break.
  $("br").replaceWith(" ");
  const cards = $(`a.lkbill${String(year).slice(-2)}`).filter(
    (_, element) => text($(element).find("#titblocarr").text()) === "FORFAIT 4 JOURS",
  );
  const widget = $("a.weezevent-widget-integration");
  const route = widget.attr("href") ?? "";
  if (
    cards.length !== 1 ||
    widget.length !== 1 ||
    !enabled($, widget) ||
    widget.attr("data-src") !== route ||
    !/^https:\/\/widget\.weezevent\.com\/ticket\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\?locale=fr-FR$/i.test(
      route,
    )
  )
    return fail("ordinary four-day pass or official widget absent or ambiguous");
  const card = cards.first();
  const price = text(card.find("#desccarr").text());
  if (
    !enabled($, card) ||
    card.attr("href") !== "/achat/" ||
    negative.test(text(card.text())) ||
    !/^\d+\s*€$/.test(price) ||
    !/^Disponible(?: OFFRE LIMITÉE)?$/.test(text(card.find("#mentionfinbill").text()))
  )
    return fail("ordinary pass availability/control missing or conflicting");
  return {
    status: "available",
    excerpt: `${title}; FORFAIT 4 JOURS; ${price}; Disponible; ${route}`,
  };
}
