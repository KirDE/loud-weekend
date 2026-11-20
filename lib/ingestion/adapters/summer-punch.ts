import type { FestivalSource } from '../types.ts';
const text = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (s: string, key: string) => s.match(new RegExp(`(?:^|\\s)${key}=["']([^"']*)["']`, 'i'))?.[1];
const identity = (s: string) => s.toLowerCase().replace(/\b(?:ft|feat)\./g, 'featuring');

// Accessible names on actual artist links corroborate the edition-bound hero
// heading. Never parse poster pixels, biographies or Next.js hydration scripts.
export function summerPunch(input: string, source: FestivalSource) {
  if (source.url !== 'https://summerpunchfestival.pl/') return undefined;
  const html = input.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  if (!title.startsWith(`Summer Punch Festival ${source.editionYear} `)) return undefined;
  const hero = html.match(/<section\b[^>]*class=["'][^"']*\bhero-shell__section\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  if (!hero) return undefined;
  const heading = text(hero.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const announcement = heading.match(/^Summer Punch Festival, (\d{1,2})-(\d{1,2}) czerwca (20\d{2}), Letnia Scena Progresji, Warszawa\. Wystąpią: (.+)$/);
  if (!announcement || Number(announcement[3]) !== source.editionYear) return undefined;
  const first = Number(announcement[1]), last = Number(announcement[2]), year = source.editionYear;
  if (first < 1 || last > 30 || last < first || last - first > 7) return undefined;
  const headerDates = [...html.matchAll(/<p\b[^>]*>\s*(\d{1,2})-(\d{1,2})\.06\.(20\d{2})\s*<\/p>/g)];
  if (headerDates.length !== 1 || headerDates[0].slice(1).join('/') !== [announcement[1],announcement[2],announcement[3]].join('/')) return undefined;
  const lineup: string[] = [], urls = new Set<string>();
  for (const link of hero.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(link[1], 'href') ?? '';
    let url: URL; try { url = new URL(href, source.url); } catch { return undefined; }
    if (!url.pathname.startsWith('/lineup/')) continue;
    if (url.origin !== 'https://summerpunchfestival.pl' || url.username || url.password || url.search || url.hash || !/^\/lineup\/[a-z0-9-]+$/.test(url.pathname) || urls.has(url.href)) return undefined;
    urls.add(url.href);
    const aria = attr(link[1], 'aria-label');
    let name = text(link[2]);
    if (aria) {
      const day = aria.match(/^(.+), (?:MON|TUE|WED|THU|FRI|SAT|SUN) (\d{2})\.06$/);
      if (!day || Number(day[2]) < first || Number(day[2]) > last) return undefined;
      name = day[1];
    }
    if (!name || name.length > 100 || /[<>&]|\p{C}|\b(?:tba|20\d{2})\b/iu.test(name) || lineup.some(n => identity(n) === identity(name))) return undefined;
    lineup.push(name);
  }
  const names = announcement[4].split(', ').map(identity);
  if (!lineup.length || names.length !== lineup.length || lineup.some((n, i) => identity(n) !== names[i])) return undefined;
  const ticket = [...hero.matchAll(/<a\b([^>]*)>/g)].some(m => attr(m[1], 'href') === '/bilety');
  if (!ticket) return undefined;
  return { editionYear: year, startDate: `${year}-06-${String(first).padStart(2,'0')}`, endDate: `${year}-06-${String(last).padStart(2,'0')}`,
    city: 'Warszawa', lineup, status: 'partial' as const, artistListMode: 'additive' as const, lineupScope: 'announcement' as const,
    ticketsUrl: 'https://summerpunchfestival.pl/bilety', excerpt: heading };
}
