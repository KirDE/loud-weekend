import type { FestivalSource } from '../types.ts';
export const FULL_REWIND_HOME = 'https://full-rewind.de/';
export const FULL_REWIND_BANDS = 'https://full-rewind.de/pages/bands_2025';
export const FULL_REWIND_DOCUMENTS = 'full-rewind-official-documents-v1';
export function isFullRewind(source: FestivalSource) {
  return source.festivalSlug === 'full-rewind' && source.url === FULL_REWIND_HOME && source.strategies.includes('official_markup');
}
const text = (s: string) => s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
const attr = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
export function fullRewind(document: string, source: FestivalSource) {
  if (!isFullRewind(source)) return undefined;
  let bundle: {kind?: string; home?: string; bands?: string};
  try { bundle = JSON.parse(document); } catch { return undefined; }
  if (bundle.kind !== FULL_REWIND_DOCUMENTS || typeof bundle.home !== 'string' || typeof bundle.bands !== 'string') return undefined;
  const home = bundle.home.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const bands = bundle.bands.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!home || !bands) return undefined;
  const footer = bundle.home.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1];
  if (!footer) return undefined;
  const h = text(footer);
  if (!new RegExp(`Full Rewind ${source.editionYear}\\b`).test(h) || !/Roitzschjora is back!/i.test(h)) return undefined;
  // The legacy URL is not edition evidence: the actual EComposer page title is.
  const page = bands.match(/window\.EComposer\.PAGE\s*=\s*(\{[^;]+\});/)?.[1];
  if (!page) return undefined;
  try { if (JSON.parse(page).title !== `Bands ${source.editionYear}`) return undefined; } catch { return undefined; }
  const date = h.match(/Vom\s+(\d{1,2})\.(\d{2})\.\s*[–—-]\s*(\d{1,2})\.(\d{2})\.(20\d{2})\b/i);
  if (!date || Number(date[5]) !== source.editionYear || date[2] !== date[4]) return undefined;
  const iso = (d: string) => `${date[5]}-${date[2]}-${d.padStart(2,'0')}`;
  const startDate = iso(date[1]), endDate = iso(date[3]);
  if (![startDate,endDate].every(d => { const dt=new Date(`${d}T00:00:00Z`); return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0,10)===d; }) || endDate < startDate || Number(date[3])-Number(date[1])>7) return undefined;
  const ticketsUrl = `${FULL_REWIND_HOME}collections/tickets-${source.editionYear}`;
  if (!home.includes(`/collections/tickets-${source.editionYear}`) && !bundle.home.includes(`href="/collections/tickets-${source.editionYear}"`)) return undefined;
  const names: string[] = [];
  const verifiedLabels: Record<string,string> = {AILD:'As I Lay Dying',LOD:'Legion of the Damned','Booze-_-Glory':'Booze & Glory'};
  for (const match of bands.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').matchAll(/<img\b[^>]*>/gi)) {
    const alt = attr(match[0], 'alt') ?? '';
    if (!alt.startsWith('Full-Rewind_Bands_')) continue;
    const label = alt.slice('Full-Rewind_Bands_'.length);
    const src = (attr(match[0], 'src') ?? '').replace(/&amp;/g,'&');
    // Require an actual captioned card on the official store, not navigation or arbitrary alt text.
    let image: URL; try { image = new URL(src); } catch { return undefined; }
    if (image.origin !== 'https://cdn.shopify.com' || !image.pathname.startsWith('/s/files/1/0778/0528/9815/files/') || image.pathname.split('/').at(-1) !== `${alt}.jpg`) return undefined;
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(label)) return undefined;
    const name = verifiedLabels[label] ?? label.replace(/-/g,' ');
    if (names.some(n=>n.toLowerCase()===name.toLowerCase())) return undefined;
    names.push(name);
  }
  if (!names.length) return undefined;
  return {editionYear:source.editionYear,startDate,endDate,city:'Roitzschjora',ticketsUrl,
    lineup:names,status:'partial' as const,lineupScope:'announcement' as const,artistListMode:'additive' as const,
    lineupSourceUrl:FULL_REWIND_BANDS,excerpt:`${date[0]}; Bands ${source.editionYear}: ${names.join('; ')}`};
}
