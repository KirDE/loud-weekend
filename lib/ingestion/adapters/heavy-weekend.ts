import type { FestivalSource } from "../types.ts";

const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|quot|apos|#x[\da-f]+|#\d+);/gi, entity => {
  const named: Record<string, string> = {"&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'"};
  if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
  const point = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
  if (!(point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff))) return entity;
  const decoded = String.fromCodePoint(point);
  return /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}]/u.test(decoded) ? entity : decoded;
}).replace(/\s+/g, " ").trim();
const attribute = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2];

export const HEAVY_DOCUMENTS = "heavy-weekend-linked-artists-v1";
export type HeavyDocument = { url: string; html: string };
const origin = "https://www.heavyweekend.live";
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<([a-z][a-z0-9]*)\b(?=[^>]*(?:\shidden(?:\s|>|=)|aria-hidden=["']true["']|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1>/gi, " ");
export function isHeavyHomepage(source: FestivalSource): boolean {
  return source.festivalSlug === "heavy-weekend" && source.url === origin + "/" && source.strategies.includes("official_markup");
}
function artistLinks(html: string) {
  return [...clean(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => {
    const href = attribute(m[1], "href");
    if (!href) return false;
    try { return /^\/line-up\/[a-z0-9][a-z0-9-]*\/?$/.test(new URL(href, origin).pathname); } catch { return false; }
  });
}
function artistUrl(tag: string): string | undefined {
  try {
    const url = new URL(attribute(tag, "href") ?? "", origin);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && /^\/line-up\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}
function cardName(body: string): string {
  const heading = body.match(/<h3\b[^>]*class=["'][^"']*\bartist-same-day-name\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1];
  const image = body.match(/<img\b[^>]*>/i)?.[0];
  const logo = image && attribute(image, "src")?.startsWith("https://cdn.prod.website-files.com/") ? attribute(image, "alt") : undefined;
  return text(heading ?? logo ?? "");
}
export function heavyMissingArtistUrls(home: string, includeLabeled = false): string[] {
  const urls = new Set<string>();
  for (const link of artistLinks(home)) {
    const url = artistUrl(link[1]);
    if (!url) throw new Error("Heavy Week-End artist link changed its trusted identity");
    if (includeLabeled || !cardName(link[2])) urls.add(url);
  }
  if (urls.size > 20) throw new Error("Heavy Week-End artist detail limit exceeded");
  return [...urls];
}
function detailName(html: string, year: number, label = ""): string | undefined {
  const document = clean(html);
  const title = text(document.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const match = title.match(/^(.+?) au Heavy Week-End (20\d{2})$/i);
  const headings = [...document.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(m[1]));
  if (!match || Number(match[2]) !== year || headings.length !== 1 || headings[0].toLowerCase() !== match[1].toLowerCase()) return undefined;
  // A short title can be a logo credit, while the primary biography explicitly
  // identifies the performing collaboration. Only its first paragraph's first
  // emphasized name followed by present-tense self-identification is evidence;
  // historical credits, other artists and related-day cards are not billing.
  const expanded = new Map<string, string>();
  for (const block of document.matchAll(/<div\b([^>]*)>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    // This observed Webflow class identifies the primary artist biography;
    // generic related/archive rich-text blocks must never supply billing.
    const classes = (attribute(block[1], "class") ?? "").split(/\s+/);
    if (!classes.includes("rich-text-block-7") || !classes.includes("w-richtext")) continue;
    const credit = block[2].match(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i);
    if (!credit) continue;
    const before = text(block[2].slice(0, credit.index!));
    const after = text(block[2].slice(credit.index! + credit[0].length));
    // A present-tense release statement ("est sorti") is not identification.
    // Require a performing-group noun and exclude only an adjacent release
    // subject, not historical material mentioned in an introductory clause.
    const subject = before.split(/[,;:]/).at(-1)!.trim();
    const releaseSubject = /^(?:(?:(?:son|sa|ses|leur|leurs|cet|cette|ce|ces|le|la|les|un|une|des)\s+|l['’])(?:(?!(?:projets?|groupes?)\b)[^\s,;:]+\s+)*|(?:(?:ancien(?:ne)?s?|historique)\s+)?)(?:singles?|albums?|titres?|morceaux?|chansons?)(?:\s+[^,;:]*)?$/i.test(subject);
    const historicalGroup = /^(?:(?:son|sa|ses|leur|leurs|cet|cette|ce|ces|le|la|les|un|une|des)\s+|l['’])?(?:(?:ancien(?:ne)?s?|historique)\s+(?:projet|groupe)s?|(?:projet|groupe)s?\s+(?:ancien(?:ne)?s?|historique))(?:\s+[^,;:]*)?$/i.test(subject);
    if (releaseSubject || historicalGroup ||
      !/^est\s+(?:sans aucun doute\s+)?(?:(?:un|une|le|la|l['’]un(?:e)?)(?:\s+des)?\s+)?(?:collaborations?|groupes?|formations?|duos?|trios?|quatuors?|quintettes?)\b/i.test(after)) continue;
    const full = text(credit[2]).match(/^(.+?)\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i);
    if (full && full[1].toLowerCase() === headings[0].toLowerCase()) {
      const name = `${full[1]} featuring ${full[2]}`;
      if (!expanded.has(name.toLowerCase())) expanded.set(name.toLowerCase(), name);
    }
  }
  if (expanded.size > 1) return undefined;
  // Use explicit current official text, never URL slugs or logo filenames.
  const name = [...expanded.values()][0] ?? headings[0];
  const identity = (s: string) => s.toLowerCase().replace(/\b(?:ft|feat)\.?(?=\s)/g, "featuring");
  if (label && identity(label) !== identity(headings[0]) && identity(label) !== identity(name)) return undefined;
  return name;
}

// Read only explicit linked artist labels. Logo pixels, poster composition,
// billing size, ticket stock and a complete inventory are deliberately not inferred.
export function heavyWeekEnd(input: string, source: FestivalSource) {
  let html = input, documents: HeavyDocument[] = [];
  if (input.trimStart().startsWith("{")) {
    try {
      const data = JSON.parse(input);
      if (data.kind !== HEAVY_DOCUMENTS || typeof data.home !== "string" || !Array.isArray(data.documents) || data.documents.length > 20 || data.documents.some((d: HeavyDocument) => !d || typeof d.url !== "string" || typeof d.html !== "string")) return undefined;
      html = data.home; documents = data.documents;
      const urls = heavyMissingArtistUrls(html, true);
      if (documents.length !== urls.length || documents.some(d => !urls.includes(d.url)) || new Set(documents.map(d => d.url)).size !== documents.length) return undefined;
    } catch { return undefined; }
  }
  let page: URL;
  try { page = new URL(source.url); } catch { return undefined; }
  if (page.href !== "https://www.heavyweekend.live/") return undefined;
  const document = clean(html);
  const title = text(document.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const year = Number(title.match(/^Heavy Week-End\s+(20\d{2})$/i)?.[1]);
  if (!Number.isInteger(year) || year !== source.editionYear) return undefined;
  const dated = [...document.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(m => text(m[1])).filter(value => /^\d{1,2}(?:-\d{1,2})+\s+[\p{L}]+\s+20\d{2}$/u.test(value));
  const dates = [...new Set(dated)];
  if (dates.length !== 1) return undefined;
  const match = dates[0].match(/^(\d{1,2}(?:-\d{1,2})+)\s+([\p{L}]+)\s+(20\d{2})$/u)!;
  const month = months.indexOf(match[2].toLowerCase());
  const days = match[1].split("-").map(Number);
  if (Number(match[3]) !== year || month < 0 || days.some((day, i) => day < 1 || new Date(Date.UTC(year, month, day)).getUTCMonth() !== month || (i > 0 && day !== days[i - 1] + 1))) return undefined;
  const lineup: string[] = [];
  const evidence: string[] = [];
  for (const link of document.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(link[1], "href");
    if (!href) continue;
    let target: URL;
    try { target = new URL(href, page); } catch { continue; }
    if (!/^\/line-up\/[a-z0-9][a-z0-9-]*\/?$/.test(target.pathname)) continue;
    if (target.origin !== page.origin || target.username || target.password || target.search || target.hash) return undefined;
    const label = cardName(link[2]);
    const doc = documents.find(d => d.url === target.href);
    const name = doc ? (detailName(doc.html, year, label) ?? "") : label;
    // An unlabeled/image-only new card must retain review, not silently vanish.
    if (!name || name.length > 100 || /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}]/u.test(name) || /[<>]|&[a-z#\d]+;|\b(?:coming soon|tickets?|20\d{2})\b/i.test(name)) return undefined;
    if (lineup.some(old => old.toLowerCase() === name.toLowerCase())) continue;
    lineup.push(name); evidence.push(`${target.href}: ${name}`);
  }
  if (!lineup.length) return undefined;
  return { editionYear: year,
    startDate: new Date(Date.UTC(year, month, days[0])).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month, days.at(-1)!)).toISOString().slice(0, 10),
    lineup, status: "partial" as const, artistListMode: "additive" as const, lineupScope: "announcement" as const,
    excerpt: `${title}; ${dates[0]}; ${evidence.join("; ")}` };
}
