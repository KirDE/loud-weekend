import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { FestivalCandidate, FestivalSource } from "../types.ts";

const months: Record<string, number> = {
  enero: 1,
  gener: 1,
  january: 1,
  febrero: 2,
  febrer: 2,
  february: 2,
  marzo: 3,
  març: 3,
  march: 3,
  abril: 4,
  april: 4,
  mayo: 5,
  maig: 5,
  may: 5,
  junio: 6,
  juny: 6,
  june: 6,
  julio: 7,
  juliol: 7,
  july: 7,
  agosto: 8,
  agost: 8,
  august: 8,
  septiembre: 9,
  setembre: 9,
  september: 9,
  octubre: 10,
  october: 10,
  noviembre: 11,
  novembre: 11,
  november: 11,
  diciembre: 12,
  desembre: 12,
  december: 12,
};

export function isBarcelonaSource(source: FestivalSource): boolean {
  try {
    const url = new URL(source.url);
    return (
      source.festivalSlug === "barcelona-rock-fest" &&
      url.origin === "https://www.barcelonarockfest.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/(?:en\/?|es\/?|ca\/?)?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function validateBarcelonaFetch(
  source: FestivalSource,
  result?: {
    response: Response;
    attempts: number;
  },
): void {
  if (source.festivalSlug !== "barcelona-rock-fest") return;
  if (!isBarcelonaSource(source) || source.fetchUrl || source.followLinkPattern) {
    throw Object.assign(new Error("Barcelona homepage identity is not configured"), {
      attempts: 0,
    });
  }
  // The homepage negotiates /en, /es or /ca using Accept-Language. These
  // are the same reviewed source; archives and other origins remain rejected.
  if (result?.response.url && !isBarcelonaSource({ ...source, url: result.response.url })) {
    throw Object.assign(new Error("Barcelona homepage identity changed"), {
      attempts: result.attempts,
    });
  }
}

// Recognize the site's standard mobile-first visibility overrides. An
// ancestor and its control must be visible in the same breakpoint range.
const breakpoints = ["", "sm:", "md:", "lg:", "xl:", "2xl:"];
const visibleDisplays = [
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
];

function visibleAt(classes: string[], viewport: number) {
  let displayed = true;
  let visible = true;
  for (const prefix of breakpoints.slice(0, viewport + 1)) {
    if (classes.includes(prefix + "hidden")) displayed = false;
    else if (visibleDisplays.some((display) => classes.includes(prefix + display)))
      displayed = true;
    if (classes.includes(prefix + "invisible")) visible = false;
    else if (classes.includes(prefix + "visible")) visible = true;
  }
  return displayed && visible;
}

function visibleViewports($: CheerioAPI, node: Cheerio<AnyNode>) {
  const lineage = [...node.toArray(), ...node.parents().toArray()].map((element) =>
    ($(element).attr("class") ?? "").split(/\s+/),
  );
  return breakpoints
    .map((_, index) => index)
    .filter((index) => lineage.every((classes) => visibleAt(classes, index)));
}

// The current homepage has explicit date/sales headings, not Event JSON-LD.
// Do not infer duration from the evergreen FAQ or dates from last year's images.
export function applyBarcelonaBanner(
  html: string,
  source: FestivalSource,
  candidate: FestivalCandidate,
): void {
  if (source.festivalSlug !== "barcelona-rock-fest") return;
  // Generic discovery cannot bind a URL or stock to the validated control.
  delete candidate.ticketStatus;
  delete candidate.ticketsUrl;
  candidate.evidence = candidate.evidence.filter(
    (e) => !["ticketStatus", "ticketsUrl"].includes(e.field),
  );
  if (!isBarcelonaSource(source)) return;
  // Only visible official banner/controls can establish a current sale.
  // Ignore hydration payloads, hidden translations and archival/footer copy.
  const $ = load(html);
  $("script, style, template, noscript, footer, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  $("[class]").each((_, element) => {
    if (!visibleViewports($, $(element)).length) $(element).remove();
  });
  $("br").replaceWith(" ");
  const purchase = $("a[href]").filter((_, element) => {
    const link = $(element);
    if (
      link.is("[disabled], [aria-disabled='true'], .disabled") ||
      link.parents("[disabled], [aria-disabled='true'], .disabled").length ||
      !/^(?:tickets?|entradas?|entrades)$/i.test(link.text().replace(/\s+/g, " ").trim())
    )
      return false;
    try {
      const target = new URL(link.attr("href") ?? "", source.url);
      return (
        target.origin === "https://www.barcelonarockfest.com" &&
        !target.username &&
        !target.password &&
        !target.search &&
        !target.hash &&
        /^\/(?:en\/|es\/|ca\/)?tickets\/?$/.test(target.pathname)
      );
    } catch {
      return false;
    }
  });
  const headings = $("h2.par-2, h2.par-3")
    .toArray()
    .map((element) => {
      const heading = $(element);
      return {
        role: heading.hasClass("par-2") ? "2" : "3",
        text: heading.text().replace(/\s+/g, " ").trim(),
        excerpt: $.html(element).slice(0, 500),
        viewports: visibleViewports($, heading),
      };
    });
  const dates = headings.filter((h) => h.role === "2");
  if (dates.length !== 1) return; // Conflicting banners need review, not a guess.
  const match = dates[0].text.match(/^(\d{1,2}(?:\s*[-–,]\s*\d{1,2})*)\s+([\p{L}]+)\s+(20\d{2})$/u);
  if (!match) return;
  const month = months[match[2].toLowerCase()],
    year = Number(match[3]);
  const days = match[1].split(/\s*[-–,]\s*/).map(Number);
  if (!month || days.some((day, i) => day < 1 || day > 31 || (i > 0 && day !== days[i - 1] + 1)))
    return;
  const iso = (day: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (days.some((day) => new Date(`${iso(day)}T00:00:00Z`).toISOString().slice(0, 10) !== iso(day)))
    return;
  candidate.observedEditionYears.push(year);
  if (year !== source.editionYear) return;
  const add = (
    field: "startDate" | "endDate" | "ticketStatus" | "ticketsUrl",
    value: string,
    excerpt: string,
  ) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence = candidate.evidence.filter((e) => e.field !== field);
    candidate.evidence.push({
      field,
      sourceUrl: source.url,
      observedAt: candidate.fetchedAt,
      excerpt,
    });
  };
  add("startDate", iso(days[0]), dates[0].excerpt);
  add("endDate", iso(days.at(-1)!), dates[0].excerpt);
  // Visible dated announcement headings are independent of the stale image
  // poster and hidden multilingual Nuxt payload. Never infer headline billing.
  const visible = $.html();
  const names: string[] = [];
  for (const heading of visible.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const text = heading[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
    const announcement = text.match(
      new RegExp(
        "^(.{1,100}?),\\s*(?:(?:Monday|Tuesday|Wednesday|Thursday|Frid" +
          "ay|Saturday|Sunday), July (\\d{1,2})(?:st|nd|rd|th)? at|(?:lu" +
          "nes|martes|miércoles|jueves|viernes|sábado|domingo) (\\d{1,2}" +
          ") de julio en|(?:dilluns|dimarts|dimecres|dijous|divendres|d" +
          "issabte|diumenge) (\\d{1,2}) de juliol al) Barcelona Rock Fes" +
          "t (20\\d{2})$",
        "iu",
      ),
    );
    if (!announcement || Number(announcement[5]) !== year || month !== 7) continue;
    const day = Number(announcement[2] ?? announcement[3] ?? announcement[4]);
    if (!days.includes(day)) continue;
    const name = announcement[1].trim();
    if (!name || /^(?:line up|tickets?|artists?)$/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
    candidate.evidence.push({
      field: "lineup",
      sourceUrl: source.url,
      observedAt: candidate.fetchedAt,
      excerpt: heading[0].slice(0, 500),
    });
  }
  if (names.length) {
    candidate.lineup = [...new Set([...(candidate.lineup ?? []), ...names])];
    candidate.lineupScope = "announcement";
    candidate.artistListMode = "additive";
  }
  const sales = headings.filter((h) => h.role === "3");
  if (
    sales.length === 1 &&
    /^(?:tickets? ya a la venta|tickets? (?:are )?(?:now on sale|on sale(?: now)?)|entrades ja a la venda)$/i.test(
      sales[0].text,
    )
  ) {
    const control = purchase
      .filter((_, element) =>
        visibleViewports($, $(element)).some(
          (viewport) =>
            dates[0].viewports.includes(viewport) && sales[0].viewports.includes(viewport),
        ),
      )
      .first();
    const href = control.attr("href");
    if (!href) return;
    const controlProof = $.html(control);
    const target = new URL(href, source.url);
    if (/^\/tickets\/?$/.test(target.pathname)) target.pathname = "/en/tickets";
    add("ticketsUrl", target.href, controlProof);
    add("ticketStatus", "available", sales[0].excerpt + "\n" + controlProof);
  }
}
