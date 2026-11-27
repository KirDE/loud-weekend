import { load } from "cheerio";
import { createHash } from "node:crypto";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import type { FestivalCandidate, FestivalSource } from "../types.ts";

/** Keep source-specific locale policy out of the generic transport. */
export function hellfestHomepageHeaders(source: FestivalSource): Record<string, string> {
  if (!isHellfestHomepage(source)) return {};
  // The root negotiates locale; /en is an explicit route and must not be silently rewritten.
  return new URL(source.url).pathname === "/" ? { "accept-language": "fr-FR,fr;q=0.9" } : {};
}

function isHellfestHomepage(source: FestivalSource): boolean {
  if (source.festivalSlug !== "hellfest" || !source.strategies.includes("html_fallback"))
    return false;
  const url = new URL(source.url);
  return (
    url.origin === "https://hellfest.fr" &&
    /^\/(?:en|fr)?\/?$/.test(url.pathname) &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    !source.fetchUrl &&
    !source.followLinkPattern
  );
}

/** Current homepage cards, not archived news or the entire hydration artist database. */
export function extractHellfestLineup(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate | undefined {
  if (!isHellfestHomepage(source)) return undefined;
  const url = new URL(source.url);
  const $ = load(html);
  const payload = $("script#__NUXT_DATA__").text();
  $("script,style,template,noscript,nav,footer,[hidden],[aria-hidden='true']").remove();
  const c: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };
  const fail = (message: string) => {
    c.warnings.push(message);
    return c;
  };
  const date = $("#hellbangers-date").text().replace(/\s+/g, " ").trim();
  const year = date.match(/\b(20\d{2})\b/)?.[1];
  if (Number(year) !== source.editionYear)
    return fail("Hellfest current homepage edition missing or mismatched");
  const cards = $(".home__bands a.home__bands-artist-name, .home__bands a.home__bands-artist-img");
  if (!cards.length) return fail("Hellfest current homepage artist cards missing");
  // Hydration only supplies the literal title for a visible logo card; never derive a
  // name from a slug, image filename, biography or unrelated archived payload entry.
  const titles = new Map<string, Set<string>>();
  try {
    const data: unknown = JSON.parse(payload);
    if (Array.isArray(data))
      for (const row of data) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        if (!Number.isInteger(r.slug) || !Number.isInteger(r.title)) continue;
        const slug = data[r.slug as number],
          title = data[r.title as number];
        if (typeof slug !== "string" || typeof title !== "string") continue;
        const values = titles.get(slug) ?? new Set<string>();
        values.add(title.replace(/\s+/g, " ").trim());
        titles.set(slug, values);
      }
  } catch {
    /* Text cards can still be read without hydration. */
  }
  const names = new Map<string, string>();
  let invalid = false;
  cards.each((_, el) => {
    const card = $(el);
    let u: URL;
    try {
      u = new URL(card.attr("href") ?? "", source.url);
    } catch {
      invalid = true;
      return;
    }
    const match = u.pathname.match(/^\/(?:artiste|(?:en|fr)\/artist)\/([a-z0-9-]+)\/?$/);
    if (u.origin !== url.origin || u.search || u.hash || u.username || u.password || !match) {
      invalid = true;
      return;
    }
    const literal = card.text().replace(/\s+/g, " ").trim();
    const values = titles.get(match[1]);
    const name = literal || (values?.size === 1 ? [...values][0] : "");
    if (
      !name ||
      name.length > 120 ||
      (values && (values.size !== 1 || !values.has(name))) ||
      (names.has(match[1]) && names.get(match[1]) !== name)
    ) {
      invalid = true;
      return;
    }
    names.set(match[1], name);
  });
  if (invalid || !names.size) return fail("Hellfest artist identity missing or conflicting");
  c.observedEditionYears = [source.editionYear];
  c.lineup = [...new Set(names.values())];
  c.status = "partial";
  c.lineupScope = "announcement";
  c.artistListMode = "additive";
  c.evidence.push({
    field: "lineup",
    adapter: "hellfest-homepage-v1",
    sourceUrl: source.url,
    observedAt: fetchedAt,
    contentHash: createHash("sha256").update(html).digest("hex"),
    excerpt: `${date}: ${c.lineup.join("; ")}`.slice(0, 1500),
  });
  return c;
}
