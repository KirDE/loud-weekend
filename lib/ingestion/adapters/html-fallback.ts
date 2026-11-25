import { extractPolandrockCandidate, isPolandrockSource } from "./polandrock.ts";
import { extractBrutalAssaultCandidate } from "./brutal-assault.ts";
import { extractMysticCandidate } from "./mystic.ts";
import { extractIdaysCandidate } from "./idays.ts";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import { extractMastersOfRockCandidate } from "./masters-of-rock.ts";
import { extractSummerBreezeCandidate } from "./summer-breeze.ts";
import { extractEurockeennesCandidate } from "./eurockeennes.ts";
import { applyBarcelonaBanner, isBarcelonaSource } from "./barcelona-banner.ts";
import { extractOfficialMarkupCandidate } from "./official-markup.ts";
import { extractResurrectionCandidate } from "./resurrection.ts";
import { extractSwedenRockCandidate } from "./sweden-rock.ts";
import { extractAlcatrazCandidate } from "./alcatraz.ts";
import { validateGenericLineup } from "../lineup-quality.ts";

type SupportedField = FieldEvidence["field"];

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function plainDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  // A valid ISO date-time asserts its own local calendar day, not the UTC day.
  return value.match(/^(\d{4}-\d{2}-\d{2})[Tt]\d/)?.[1] ?? parsed.toISOString().slice(0, 10);
}

type MarkedValue = { value: string; excerpt: string };

function* metaContents(html: string, names: string[]): Generator<MarkedValue, undefined> {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (expected.has(key) && content) yield { value: content, excerpt: match[0].slice(0, 500) };
  }
  return undefined;
}

function markedDate(
  html: string,
  role: "start" | "end",
  warnings: string[],
): MarkedValue | undefined {
  const values = [
    ...metaContents(html, [`event:${role}_time`, `event:${role}_date`, `festival:${role}_date`]),
    ...markedTimes(html, role),
  ];
  const days = new Set(values.map(({ value }) => plainDate(value)).filter(Boolean));
  if (days.size > 1) warnings.push(`Conflicting HTML festival ${role} date declarations`);
  return values[0];
}

function* markedTimes(html: string, role: "start" | "end"): Generator<MarkedValue, undefined> {
  const markers = new Set([
    role,
    `${role}date`,
    `${role}-date`,
    `festival-${role}`,
    `festival-${role}-date`,
  ]);
  for (const match of html.matchAll(/<time\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const marker =
      `${attrs.get("itemprop") ?? ""} ${attrs.get("class") ?? ""} ${attrs.get("data-role") ?? ""}`.toLowerCase();
    if (!marker.split(/\s+/).some((token) => markers.has(token))) continue;
    const value = attrs.get("datetime");
    if (value) yield { value, excerpt: match[0].slice(0, 500) };
  }
  return undefined;
}

function ticketLink(
  html: string,
  sourceUrl: string,
): { value: string; excerpt: string } | undefined {
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const tagAndText = decode(
      `${match[0].slice(0, match[0].indexOf(">") + 1)} ${match[3].replace(/<[^>]+>/g, " ")}`,
    ).toLowerCase();
    // Agent corrections: merchandise/sponsor/transport shops are not festival tickets.
    if (
      /merch|souvenir|sponsor|shuttle|transport|parking|parkplatz|\btrain\b|car\s+park/.test(
        tagAndText,
      )
    )
      continue;
    if (!/\b(ticket|tickets|karten|billet|billets|entradas)\b/.test(tagAndText)) continue;
    try {
      const url = new URL(decode(match[1] ?? match[2]), sourceUrl);
      if (url.hash || /\b(?:faq|register|registration|newsletter)\b/.test(tagAndText)) continue;
      if (url.protocol === "https:") return { value: url.href, excerpt: match[0].slice(0, 500) };
    } catch {
      continue;
    }
  }
  return undefined;
}

function markedNames(
  html: string,
  barcelona = false,
): { values: string[]; excerpt: string; warnings: string[] } | undefined {
  const values: string[] = [];
  const combinedFlags: boolean[] = [];
  let excerpt = "";
  const pattern = new RegExp(
    "<([a-z][\\w:-]*)\\b([^>]*(?:data-artist|itemprop\\s*=\\s*[\"']per" +
      "former[\"']|class\\s*=\\s*[\"'][^\"']*(?:artist|lineup)[^\"']*[\"']" +
      ")[^>]*)>([\\s\\S]*?)<\\/\\1>",
    "gi",
  );
  for (const match of html.matchAll(pattern)) {
    const attrs = attributes(`<${match[1]} ${match[2]}>`);
    const inner = match[3];
    // Barcelona's section title is decoration, not an artist assertion. Keep
    // malformed explicit performers and all other source warnings unchanged.
    if (
      barcelona &&
      match[1].toLowerCase() === "h2" &&
      /(?:^|\s)lineup-text(?:\s|$)/.test(attrs.get("class") ?? "") &&
      !attrs.has("data-artist") &&
      !attrs.has("itemprop") &&
      /^line up$/i.test(decode(inner))
    )
      continue;
    const value = decode(attrs.get("data-artist") ?? inner.replace(/<[^>]+>/g, " "));
    if (value) {
      values.push(value);
      combinedFlags.push(
        !attrs.has("data-artist") &&
          /<br\b|<li\b|data-artist|itemprop\s*=\s*["']performer/iu.test(inner),
      );
      if (!excerpt) excerpt = match[0].slice(0, 500);
    }
  }
  const quality = validateGenericLineup(values, combinedFlags);
  return quality.names.length || quality.warnings.length
    ? { values: quality.names, excerpt, warnings: quality.warnings }
    : undefined;
}

export function extractHtmlFallbackCandidate(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate {
  if (isPolandrockSource(source)) return extractPolandrockCandidate(html, source, fetchedAt);
  const brutalAssault = extractBrutalAssaultCandidate(html, source, fetchedAt);
  if (brutalAssault) return brutalAssault;
  if (source.festivalSlug === "mystic") return extractMysticCandidate(html, source, fetchedAt);
  if (source.festivalSlug === "masters-of-rock")
    return extractMastersOfRockCandidate(html, source, fetchedAt);
  if (source.festivalSlug === "idays") return extractIdaysCandidate(html, source, fetchedAt);
  if (source.festivalSlug === "summer-breeze")
    return extractSummerBreezeCandidate(html, source, fetchedAt);
  if (source.festivalSlug === "eurockeennes")
    return extractEurockeennesCandidate(html, source, fetchedAt);
  if (source.festivalSlug === "sweden-rock")
    return extractSwedenRockCandidate(html, source, fetchedAt);
  // Existing DB-owned generic Rock Werchter sources can consume the verified
  // homepage markup without a configuration edit or resetting source backoff.
  if (source.festivalSlug === "rock-werchter") {
    const official = extractOfficialMarkupCandidate(html, source, fetchedAt);
    if (official.evidence.length) return official;
  }
  if (
    source.festivalSlug === "resurrection-fest" &&
    new URL(source.url).hostname === "www.resurrectionfest.es"
  ) {
    return extractResurrectionCandidate(html, source, fetchedAt);
  }
  if (source.festivalSlug === "alcatraz") return extractAlcatrazCandidate(html, source, fetchedAt);
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };
  if (source.festivalSlug === "barcelona-rock-fest" && !isBarcelonaSource(source)) {
    candidate.warnings.push("Barcelona source identity is not the reviewed homepage");
    return candidate;
  }
  const start = markedDate(html, "start", candidate.warnings);
  const end = markedDate(html, "end", candidate.warnings);
  const city = metaContents(html, ["event:location", "festival:city", "geo.placename"]).next()
    .value;
  const tickets = ticketLink(html, source.url);
  const lineup = markedNames(
    html,
    source.festivalSlug === "barcelona-rock-fest" &&
      new URL(source.url).hostname === "www.barcelonarockfest.com",
  );

  const add = (
    field: SupportedField,
    value: string | string[] | undefined,
    excerpt: string | undefined,
  ) => {
    if (value === undefined) return;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt });
  };
  add("startDate", plainDate(start?.value), start?.excerpt);
  add("endDate", plainDate(end?.value), end?.excerpt);
  add("city", city?.value, city?.excerpt);
  add("ticketsUrl", tickets?.value, tickets?.excerpt);
  add("lineup", lineup?.values, lineup?.excerpt);
  applyBarcelonaBanner(html, source, candidate);
  if (start?.value)
    candidate.observedEditionYears.push(Number(plainDate(start.value)?.slice(0, 4)));
  if (end?.value) candidate.observedEditionYears.push(Number(plainDate(end.value)?.slice(0, 4)));
  candidate.observedEditionYears = [
    ...new Set(candidate.observedEditionYears.filter(Number.isFinite)),
  ];
  candidate.warnings.push(...(lineup?.warnings ?? []));

  if (candidate.evidence.length === 0)
    candidate.warnings.push("HTML fallback did not find explicitly marked festival fields");
  return candidate;
}
