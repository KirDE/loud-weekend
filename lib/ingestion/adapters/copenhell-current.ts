import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from '../types.ts';
import { INGESTION_SCHEMA_VERSION } from '../types.ts';

const origin = 'https://copenhell.dk';
export const COPENHELL_REVIEW = 'Agent review required before lineup-triggered provider activity';
export type CopenhellDocument = { url: string; html: string };
export const copenhellEnvelope = 'copenhell-official-documents-v1';
export const copenhellPlain = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;|[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const main = (html: string) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
export function copenhellUrl(value: string): boolean {
  try { const u = new URL(value); return u.origin === origin && !u.search && !u.hash && !u.username && !u.password; } catch { return false; }
}
export function isCopenhellCurrentSource(source: FestivalSource): boolean {
  return source.festivalSlug === 'copenhell' && source.strategies.includes('official_markup') && !source.fetchUrl && !source.followLinkPattern && copenhellUrl(source.url) && /^\/(?:faith-no-more-headline-copenhell-20\d{2}\/)?$/.test(new URL(source.url).pathname);
}
// Discover actual current-edition news, not a frozen article URL or document hash.
export function copenhellNews(html: string, year: number): string[] {
  const urls = new Set<string>();
  for (const m of main(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const heading = copenhellPlain(m[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '');
    const url = new URL(m[1], origin).href;
    if (copenhellUrl(url) && new RegExp(`\\b${year}\\b`).test(heading) && /headliner|headlin(?:e|er)|billetsalget/i.test(heading)) urls.add(url);
  }
  return [...urls].slice(0, 8);
}
export function copenhellArtistLinks(html: string): { url: string; name: string }[] {
  const cards: { url: string; name: string }[] = [];
  // Only artist cards in the music grid, never navigation, activities or footer.
  const grid = main(html).match(/<div\b[^>]*class=["'][^"']*\bsort-lineup\b[^"']*["'][^>]*>([\s\S]*?)(?:Musikprogrammet|<\/main>|$)/i)?.[1] ?? '';
  const music = [...grid.matchAll(/<div\b[^>]*class=["'][^"']*\bgrid-item\b[^"']*\bmusik\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bgrid-item\b|$)/gi)].map(m => m[1]).join('');
  for (const m of music.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = copenhellPlain(m[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '');
    const url = new URL(m[1], origin).href;
    if (name && copenhellUrl(url) && /^\/artist\/[^/]+\/$/.test(new URL(url).pathname)) cards.push({ url, name });
  }
  return cards;
}
export function extractCopenhellCurrent(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isCopenhellCurrentSource(source) || !html.startsWith('{')) return undefined;
  const c: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  let docs: CopenhellDocument[];
  try { const data = JSON.parse(html); if (data.kind !== copenhellEnvelope) return undefined; docs = data.documents; if (!Array.isArray(docs) || docs.some(d => !copenhellUrl(d.url) || typeof d.html !== 'string')) throw Error(); } catch { c.warnings.push('Invalid Copenhell official document envelope'); return c; }
  const year = source.editionYear;
  const evidence = (field: FieldEvidence['field'], d: CopenhellDocument, excerpt: string) => c.evidence.push({ field, sourceUrl: d.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  const headliners = new Set<string>();
  let announced: string[] | undefined;
  let sale: CopenhellDocument | undefined;
  let saleTime = -Infinity;
  for (const d of docs) {
    const article = main(d.html).match(/<article\b[^>]*class=["'][^"']*\bh-entry\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1];
    if (!article) continue;
    const heading = copenhellPlain(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    const time = Date.parse(article.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? '');
    if (!new RegExp(`\\b${year}\\b`).test(heading) || !Number.isFinite(time) || new Date(time).getUTCFullYear() < year - 1 || new Date(time).getUTCFullYear() > year) continue;
    const text = copenhellPlain(article);
    const date = text.match(new RegExp(`COPENHELL ${year} finder sted[^.!]*?den (\\d{1,2})\\s*\\.\\s*[-–—]\\s*(\\d{1,2})\\s*\\.\\s*juni ${year}\\b`, 'i'));
    if (date) {
      const start = new Date(Date.UTC(year, 5, Number(date[1]))), end = new Date(Date.UTC(year, 5, Number(date[2])));
      if (start.getUTCMonth() === 5 && end.getUTCMonth() === 5 && end > start && Number(date[2]) - Number(date[1]) <= 6) {
        c.startDate = start.toISOString().slice(0, 10); c.endDate = end.toISOString().slice(0, 10); evidence('startDate', d, date[0]); evidence('endDate', d, date[0]);
      }
    }
    const billing = heading.match(new RegExp(`^(.+?) (?:OG (.+?) )?HEADLINER COPENHELL ${year}$`, 'i'));
    const addition = heading.match(new RegExp(`^(.+?) BLIVER (?:\\S+ )?HEADLINER PÅ COPENHELL ${year}$`, 'i'));
    const count = headliners.size;
    if (billing && /bliver næste års hovednavne/i.test(text)) billing.slice(1).filter(Boolean).forEach(n => headliners.add(n));
    if (addition && /næste års (?:\S+ )?headliner/i.test(text)) headliners.add(addition[1]);
    if (headliners.size > count) evidence('headliners', d, heading);
    // The explicit edition-bound published list is authoritative. Its ordering
    // does not establish billing; billing comes from separate announcement prose.
    const paragraphs = [...article.matchAll(/<(?:h2|p)\b[^>]*>([\s\S]*?)<\/(?:h2|p)>/gi)].map(m => copenhellPlain(m[1]));
    const intro = paragraphs.findIndex(p => new RegExp(`Billetsalget til COPENHELL ${year} er nu i gang`, 'i').test(p) && /disse bands er offentliggjort/i.test(p));
    if (intro >= 0 && time > saleTime) {
      const names = paragraphs[intro + 1]?.split(/\s+[–—]\s+/).map(n => n.trim()).filter(Boolean);
      if (names && names.length >= 2) { announced = names; sale = d; saleTime = time; }
    }
  }
  const program = docs.find(d => new URL(d.url).pathname === '/program/');
  if (announced && sale && program) {
    const cards = copenhellArtistLinks(program.html);
    const cardNames = new Set(cards.map(x => x.name.toLocaleLowerCase()));
    if (!announced.every(n => cardNames.has(n.toLocaleLowerCase()))) c.warnings.push('Copenhell announcement and live programme disagree; review the current edition');
    else {
      const canonical = (name: string) => {
        if (name.toUpperCase() !== 'ANGEL DUST') return name;
        const card = cards.find(x => x.name.toUpperCase() === 'ANGEL DUST');
        const biography = docs.find(d => d.url === card?.url);
        const text = biography ? copenhellPlain(main(biography.html)) : '';
        if (/Baltimore/i.test(text) && /Justice Tripp/i.test(text)) return 'Angel Du$t';
        c.warnings.push('Copenhell Angel Dust identity requires artist biography review'); return name;
      };
      c.headliners = [...headliners].map(canonical);
      c.lineup = [...new Set(cards.map(card => card.name))].filter(n => !headliners.has(n)).map(canonical);
      c.artistListMode = 'additive'; c.lineupScope = 'announcement';
      evidence('lineup', program, cards.map(card => card.name).join(' – '));
      if (/Musikprogrammet er endnu ikke færdiggjort/i.test(copenhellPlain(main(program.html))) || /mange flere er på vej/i.test(copenhellPlain(main(sale.html)))) { c.status = 'partial'; evidence('status', program, 'Musikprogrammet er endnu ikke færdiggjort; many more bands to come'); }
      c.warnings.push(COPENHELL_REVIEW);
    }
    const ticketDocuments = docs.filter(d => new URL(d.url).pathname === '/billetter/');
    const tickets = ticketDocuments.length === 1 ? ticketDocuments[0] : undefined;
    const failStock = () => c.warnings.push('Copenhell current ordinary four-day ticket stock requires review; no whole-event sellout inferred');
    if (!tickets) failStock();
    else {
      const $ = load(main(tickets.html));
      // Closed information dialogs contain stale festival-place labels. Dates
      // come from the visible product row + verified current sale articles,
      // never modal, archived, hydration or accessory copy.
      $("script, style, template, nav, footer, [role='dialog'], [hidden], [inert], [aria-hidden='true']").remove();
      $("[style]").each((_, element) => {
        if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
      });
      const plain = (value: string) => value.replace(/\s+/g,' ').trim();
      const containers = $(".ticket-container#4-dagsbillet");
      const cards = containers.find(".ticket");
      if (containers.length !== 1 || cards.length !== 1) failStock();
      else {
        const card = cards.first();
        const heading = card.find(".font-header").filter((_, e) => /^4-DAGSBILLET$/i.test(plain($(e).text())));
        const dates = card.children(".grow").children("div").map((_, e) => plain($(e).text())).get()
          .map(value => value.match(/^(\d{1,2})\.\s*[-–—]\s*(\d{1,2})\.\s*[-–—]\s*(\d{1,2})\.\s*[-–—]\s*(\d{1,2})\.\s*juni$/i)).filter(value => value !== null);
        const expected = c.startDate && c.endDate && c.startDate.startsWith(year + '-06-')
          && c.endDate.startsWith(year + '-06-') && Number(c.endDate.slice(-2)) - Number(c.startDate.slice(-2)) === 3
          ? Array.from({length:4},(_,i) => Number(c.startDate!.slice(-2))+i) : undefined;
        const verifiedDates = expected && dates.length === 1 && dates[0]!.slice(1).every((day,i) => Number(day) === expected[i]);
        const purchase = card.find("a[href]").filter((_, element) => {
          const link = $(element);
          if (!/^Køb nu$/i.test(plain(link.text())) || link.is("[disabled], [aria-disabled='true']")
            || link.parents("[disabled], [aria-disabled='true']").length) return false;
          try {
            const u = new URL(link.attr("href") ?? "");
            return u.origin === "https://www.ticketmaster.dk" && !u.username && !u.password && !u.hash
              && /^\/event\/[0-9]+$/.test(u.pathname)
              && [...u.searchParams.keys()].every(key => ["language","brand"].includes(key))
              && u.searchParams.get("brand") === "copenhelldk";
          } catch { return false; }
        });
        const ordinary = card.clone();
        // Only the known standalone RIP upgrade badge is outside ordinary
        // admission scope. Every other visible sellout assertion in the card
        // contradicts a lingering Buy control, regardless of tag or phrasing.
        ordinary.find("span").filter((_, e) => /^R\.I\.P\.\s+(?:tilgængelig|udsolgte?)$/i.test(plain($(e).text()))).remove();
        const sold = /\b(?:udsolgte?|sold\s*out)\b/i.test(plain(ordinary.text()));
        if (heading.length === 1 && verifiedDates && purchase.length === 1 && !sold) {
          c.ticketsUrl = tickets.url; c.ticketStatus = 'available';
          const excerpt = 'COPENHELL ' + year + '; ordinary 4-DAGSBILLET ' + dates[0]![0] + '; enabled official Ticketmaster Køb nu control';
          evidence('ticketsUrl', tickets, excerpt); evidence('ticketStatus', tickets, excerpt);
        } else failStock();
      }
    }
  }
  if (!c.headliners && headliners.size) { c.headliners = [...headliners]; c.artistListMode = 'additive'; c.warnings.push(COPENHELL_REVIEW); }
  if (c.evidence.length) c.observedEditionYears = [year]; else c.warnings.push('No trustworthy current-edition Copenhell announcement found');
  return c;
}
