import type { FestivalCandidate, FestivalSource } from '../types.ts';
export const PROVINSSI_HOME = 'https://www.provinssi.fi/en/';
const text = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
export function provinssi(document: string, source: FestivalSource) {
  if (source.url !== PROVINSSI_HOME || source.editionYear !== 2027) return undefined;
  const html = document.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  if (text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') !== 'Provinssi | Provinssi 2027') return undefined;
  const plain = text(html);
  const date = plain.match(/in (20\d{2}) Provinssi will be held in July for the first time; (\d{1,2})\.-(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (!date || Number(date[1]) !== source.editionYear || date[1] !== date[5] || date[4] !== '7' || !plain.includes('Törnävänsaari in Seinäjoki')) return undefined;
  const iso = (d: string) => `${date[5]}-07-${d.padStart(2,'0')}`;
  const startDate=iso(date[2]),endDate=iso(date[3]);
  if (![startDate,endDate].every(d=>Number.isFinite(new Date(d+'T00:00:00Z').getTime()) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d) || endDate<startDate || Number(date[3])-Number(date[2])>7) return undefined;
  const slider = html.match(/<section\b[^>]*class="artist-slider-element[^"]*"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  if (!slider) return undefined;
  const cards=[...slider.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)],lineup: string[]=[];
  for (const card of cards) {
    if (!/\bclass="artist-card box"/.test(card[1])) return undefined;
    const href=card[1].match(/\bhref="([^"]+)"/)?.[1];
    if (!href || !/^https:\/\/www\.provinssi\.fi\/en\/artists\/[a-z0-9-]+\/$/.test(href)) return undefined;
    const name=text(card[2].match(/<h3 class="artist-card__title">([\s\S]*?)<\/h3>/)?.[1]??'');
    if (!name || name.length>100 || /[<>]|\b(?:TBA|20\d{2})\b/i.test(name) || lineup.some(n=>n.toLowerCase()===name.toLowerCase())) return undefined;
    lineup.push(name);
  }
  const ticketsUrl = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]).find(href => href === 'https://provinssi.fi/en/tickets-2027');
  if (!lineup.length || !ticketsUrl) return undefined;
  return {editionYear:2027,startDate,endDate,city:'Seinäjoki',lineup,status:'partial' as const,
    artistListMode:'additive' as const,lineupScope:'announcement' as const,
    ticketsUrl,
    excerpt:`${date[0]}; Törnävänsaari in Seinäjoki; ${lineup.join('; ')}`};
}

export function isProvinssiAnnouncement(candidate: FestivalCandidate, year: number) {
  return !!candidate && year === 2027 && candidate.festivalSlug === 'provinssi' &&
    candidate.sourceUrl === PROVINSSI_HOME && candidate.artistListMode === 'additive' &&
    candidate.lineupScope === 'announcement' && candidate.status === 'partial' &&
    Array.isArray(candidate.observedEditionYears) && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === year && candidate.headliners === undefined &&
    Array.isArray(candidate.lineup) && candidate.lineup.length > 0 &&
    Array.isArray(candidate.evidence) && ['startDate','endDate','city','lineup','ticketsUrl','status'].every(field =>
      candidate.evidence.some(e => e?.field === field && e.sourceUrl === PROVINSSI_HOME));
}
