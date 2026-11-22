import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, code: string) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : _).replace(/&#x([\da-f]+);/gi, (_, code: string) => Number.parseInt(code, 16) <= 0x10ffff ? String.fromCodePoint(Number.parseInt(code, 16)) : _).replace(/&#39;|&apos;/gi, "'").replace(/&#160;|&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined);
const hasClass = (tag: string, name: string) => attr(tag, "class")?.split(/\s+/).includes(name);

/** Evergreen edition-scoped artist markers, not headings, news or a featured-card subset. */
export function extractMastersOfRockCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  let origin: URL;
  try { origin = new URL(source.url); } catch {
    candidate.warnings.push("Masters of Rock requires its reviewed official source");
    return candidate;
  }
  if (origin.protocol !== "https:" || !/^(?:www\.)?mastersofrock\.cz$/.test(origin.hostname)
    || origin.pathname !== "/" || origin.username || origin.password || origin.port || origin.search || origin.hash) {
    candidate.warnings.push("Masters of Rock requires its reviewed official source");
    return candidate;
  }
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const heroes = [...clean.matchAll(/<aside\b([^>]*)>([\s\S]*?)<\/aside>/gi)].filter(m => hasClass(m[1], "mor-hero-side"));
  const hero = heroes.length === 1 && attr(heroes[0][1], "data-mor-state") === "active" ? heroes[0][2] : undefined;
  const dateBlock = hero?.match(/<div\b[^>]*class=["'][^"']*\bmor-hero-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const date = dateBlock && text(dateBlock).match(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{2})\.(20\d{2})\b/);
  const editionLabel = hero && text(hero.split(/<p\b/i)[0]).match(/\b(20\d{2})\s*[–—-]\s*\d+\.\s*ročník\b/iu);
  if (!hero || !date || !editionLabel || editionLabel[1] !== date[4]) {
    candidate.warnings.push("Masters of Rock current edition hero/date could not be verified");
    return candidate;
  }
  const year = Number(date[4]);
  candidate.observedEditionYears = [year];
  if (year !== source.editionYear) {
    candidate.warnings.push(`Masters of Rock edition ${year} does not match configured edition ${source.editionYear}`);
    return candidate;
  }
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  const dates = [date[1], date[2]].map(day => `${year}-${date[3]}-${day.padStart(2, "0")}`);
  if (dates.some(value => !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) || dates[0] > dates[1]) {
    candidate.warnings.push("Masters of Rock hero contains invalid festival dates");
    return candidate;
  }
  add("startDate", dates[0], dateBlock!);
  add("endDate", dates[1], dateBlock!);
  const lineupBlocks = [...hero.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)].filter(m => hasClass(m[1], "mor-hero-lineup"));
  const names = lineupBlocks.length === 1 ? [...lineupBlocks[0][2].matchAll(/<span\b[^>]*\bdata-mor-band(?=\s|=|>)[^>]*>([\s\S]*?)<\/span>/gi)].map(m => text(m[1])).filter(Boolean) : [];
  if (names.length && names.every(name => name.length <= 100)) {
    add("lineup", [...new Map(names.map(name => [name.toLocaleLowerCase(), name])).values()], lineupBlocks[0][0]);
    // Announcement/featured order is not a festival headliner division or a full-bill claim.
    add("status", "partial", lineupBlocks[0][0]);
  } else candidate.warnings.push("Masters of Rock explicitly marked current artist list is missing or ambiguous");

  const ticketLinks = [...hero.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => /koupit\s+vstupenky/iu.test(text(m[2])));
  for (const link of ticketLinks) {
    try {
      const url = new URL(attr(link[1], "href") ?? "", source.url);
      if (url.protocol !== "https:" || url.origin !== new URL(source.url).origin || !/^\/(?:cs|en)\/masters-of-rock-vstupenky\/?$/.test(url.pathname) || url.search || url.hash) continue;
      add("ticketsUrl", url.href, link[0]);
      break;
    } catch { /* Invalid or non-festival links are not ticket evidence. */ }
  }
  // A dated price deadline ("nebo vyprodání") is not a stock statement.
  // Bind the visible regular full-pass card to its current festival section,
  // not hidden archives, seating upgrades, a generic shop or an expired tier.
  const $ = load(html);
  $("script, style, noscript, template, nav, footer, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
  });
  const visibleHero = $("aside.mor-hero-side[data-mor-state='active']");
  if (visibleHero.length !== 1 || !text(visibleHero.find(".mor-hero-meta").text()).includes(date[0])) {
    candidate.warnings.push("Masters of Rock ticket stock requires visible current-edition hero evidence");
    return candidate;
  }
  const section = $("section.mor-price-section").filter((_, element) =>
    text($(element).find(".mor-section-head .straight-line-wrapper").text()) === `Masters of Rock ${year}`);
  if (section.length !== 1) {
    candidate.warnings.push("Masters of Rock current ticket section is missing or ambiguous");
    return candidate;
  }
  const cards = section.find("article.mor-price-card").filter((_, element) =>
    /^Na stání(?:\s|$)/iu.test(text($(element).find("h3").text())) && $(element).find(".mor-price-note").toArray().some(note => /\b4 dny\b/iu.test(text($.html(note)))));
  if (cards.length !== 1) {
    candidate.warnings.push("Masters of Rock standard full-pass product is missing or ambiguous");
    return candidate;
  }
  const card = cards.first();
  const soldOut = /\b(?:vyprodáno|sold\s*out)\b/iu.test(text(card.text()));
  const buy = card.find("a[href]").filter((_, element) => {
    const link = $(element);
    if (link.is("[disabled], [aria-disabled='true']") || link.parents("[disabled], [aria-disabled='true']").length
      || !/koupit\s+vstupenku/iu.test(text(link.text()))) return false;
    try {
      const target = new URL(link.attr("href") ?? "", source.url);
      return target.protocol === "https:" && target.origin === origin.origin && !target.username && !target.password
        && target.pathname === `/cs/koncerty/${year}-masters-of-rock` && !target.search && !target.hash;
    } catch { return false; }
  });
  if (soldOut && buy.length) {
    candidate.warnings.push("Masters of Rock standard-pass stock conflicts with an enabled purchase control");
  } else if (soldOut) {
    add("ticketStatus", "sold_out", $.html(card));
  } else if (buy.length === 1 && /^\d[\d\s]*Kč$/u.test(text(card.find(".mor-price").text()))) {
    add("ticketStatus", "available", $.html(card));
  } else if (buy.length > 1) {
    candidate.warnings.push("Masters of Rock standard-pass purchase destination is ambiguous");
  }
  return candidate;
}
