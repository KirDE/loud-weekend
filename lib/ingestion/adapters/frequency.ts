import { load } from "cheerio";
import { INGESTION_SCHEMA_VERSION, type FestivalCandidate, type FestivalSource, type FieldEvidence } from "../types.ts";

const origin = "https://www.frequency.at";
const ticketsUrl = origin + "/tickets/";
const months: Record<string, string> = { januar: "01", january: "01", februar: "02", february: "02", märz: "03", march: "03", april: "04", mai: "05", may: "05", juni: "06", june: "06", juli: "07", july: "07", august: "08", september: "09", oktober: "10", october: "10", november: "11", dezember: "12", december: "12" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

export function isFrequencySource(source: FestivalSource): boolean {
  try { const url = new URL(source.url); return source.festivalSlug === "frequency" && url.origin === origin && !url.username && !url.password && !url.search && !url.hash && ["/", "/tickets/", "/tickets"].includes(url.pathname); } catch { return false; }
}

function stripInertMarkup($: ReturnType<typeof load>) {
  $("script, style, template, noscript, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
  });
}

export function frequencyTicketLink(html: string): boolean {
  const $ = load(html);
  stripInertMarkup($);
  return $("a[href]").toArray().some(anchor => {
    const link = $(anchor);
    if (link.closest("[disabled], [aria-disabled='true']").length) return false;
    try {
      const url = new URL(link.attr("href") ?? "", origin);
      return url.origin === origin && !url.username && !url.password
        && /^\/tickets\/?$/.test(url.pathname) && !url.search && !url.hash;
    } catch { return false; }
  });
}

// Private in-process transport, not persisted catalog data or scraped instructions.
export function frequencyDocuments(home: string, tickets: string): string {
  return JSON.stringify({ frequencyDocuments: 1, home, tickets });
}

export function extractFrequencyCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isFrequencySource(source)) return undefined;
  let home = input, tickets = new URL(source.url).pathname === "/" ? "" : input;
  if (input.startsWith('{"frequencyDocuments":')) {
    const value = JSON.parse(input);
    if (value.frequencyDocuments !== 1 || typeof value.home !== "string" || typeof value.tickets !== "string") throw new Error("Invalid Frequency document transport");
    home = value.home; tickets = value.tickets;
  }
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string, excerpt: string, sourceUrl = source.url) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  const title = text(home.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const date = title.match(/^Frequency Festival\s*\|\s*(\d{1,2})\.?\s*[-–—]\s*(\d{1,2})\.?\s+([\p{L}]+)\s+(20\d{2})\b/u);
  if (date) {
    candidate.observedEditionYears.push(Number(date[4]));
    const month = months[date[3].toLocaleLowerCase()];
    const start = `${date[4]}-${month}-${date[1].padStart(2, "0")}`, end = `${date[4]}-${month}-${date[2].padStart(2, "0")}`;
    if (Number(date[4]) === source.editionYear && month && Number(date[1]) <= Number(date[2]) && [start, end].every((day) => {
      const parsed = new Date(day); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
    })) { add("startDate", start, title); add("endDate", end, title); }
    else candidate.warnings.push("Frequency advertised dates do not match the configured edition or a valid range");
  }
  if (frequencyTicketLink(home) && candidate.startDate) add("ticketsUrl", ticketsUrl, "Official homepage links to /tickets/");
  // Scope stock to one visible ordinary admission product, never stale
  // hydration payload, duplicate markup, VIP, parking or sold-out accessories.
  const $ = load(tickets);
  stripInertMarkup($);
  $("nav, footer").remove();
  $("br").replaceWith(" ");
  const standard = $("li.ticket__excerpt").filter((_, element) =>
    text($(element).find("h2[itemprop='name']").text()) === source.editionYear + " - Festivalpass");
  const failStock = () => candidate.warnings.push("Frequency standard festival pass has no unique verified live purchase offer; do not infer global sold-out status from one product");
  if (tickets && standard.length !== 1) failStock();
  if (standard.length === 1) {
    const card = standard.first(), title = text(card.find("h2[itemprop='name']").text());
    const label = card.find("h3.ticket__extratext"), price = card.find("[itemprop='price']");
    const buy = card.find("ul.ticket__offers a[href]").filter((_, element) => {
      const link = $(element), button = link.find("button.button--offer");
      if (link.is("[disabled], [aria-disabled='true']") || link.parents("[disabled], [aria-disabled='true']").length
        || button.length !== 1 || button.is("[disabled], [aria-disabled='true']")
        || text(button.find(".major").text()) !== "zum Angebot") return false;
      try {
        const target = new URL(link.attr("href") ?? "");
        return target.origin === "https://www.oeticket.com" && !target.username && !target.password && !target.hash
          && new RegExp("^/(?:noapp/)?(?:artist/frequency/fm4-frequency-" + source.editionYear + "-\\d+|event/frequency-festival-fm4-frequency-" + source.editionYear + "-green-park-st-poelten-\\d+)/?$").test(target.pathname)
          && [...target.searchParams.keys()].every(key => ["affiliate", "utm_campaign", "utm_source", "utm_medium"].includes(key));
      } catch { return false; }
    });
    const liveLabel = label.length === 1 && /^Jetzt (?:verfügbar|erhältlich)!?$/i.test(text(label.text()));
    const priced = price.length === 1 && /^€\s*[1-9]\d*[,.]\d{2}$/.test(price.attr("content") ?? "")
      && text(price.find("[itemprop='priceCurrency']").attr("content") ?? "") === "EUR";
    const conflicting = /\b(?:ausverkauft|sold\s*out)\b/i.test(text(card.text()));
    if (liveLabel && priced && buy.length === 1 && !conflicting) {
      add("ticketsUrl", ticketsUrl, title, ticketsUrl);
      add("ticketStatus", "available", title + ": " + text(label.text()) + "; priced enabled official oeticket standard-pass offer", ticketsUrl);
      if (!candidate.observedEditionYears.includes(source.editionYear)) candidate.observedEditionYears.push(source.editionYear);
    } else failStock();
  }
  // Deliberately omit lineup/status: current ticket/date evidence does not turn
  // last year's programme or a verified partial bill into an empty lineup.
  if (!candidate.evidence.length && !candidate.warnings.length) candidate.warnings.push("Frequency page exposes no supported current-edition fields");
  return candidate;
}
