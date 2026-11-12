import type { FestivalSource } from "../types.ts";

export const DOWNLOAD_HOME = "https://downloadfestival.co.uk/";
export const DOWNLOAD_ARTISTS = DOWNLOAD_HOME + "artists-a-z/";
export const DOWNLOAD_DOCUMENTS = "download-official-artists-v1";
export const isDownloadSource = (source: FestivalSource) => source.festivalSlug === "download" && source.url === DOWNLOAD_HOME && source.strategies.includes("official_markup");
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#0*39;|&apos;/g, "'").replace(/&#8217;|&rsquo;|’/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
function dates(s: string, year: number) {
  const values = [...text(clean(s).replace(/&mdash;/g, "—")).matchAll(/(?:Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\s*(?:<[^>]*>\s*)*—\s*(?:<[^>]*>\s*)*(?:Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\s+June\s+(20\d{2})/g)];
  // The visible header/footer, not a script or an unrelated article date.
  if (!values.length || values.some(m => Number(m[3]) !== year || +m[1] < 1 || +m[2] > 30 || +m[2] < +m[1]) || new Set(values.map(m => m.slice(1).join(','))).size !== 1) return undefined;
  return { startDate: `${year}-06-${values[0][1].padStart(2,"0")}`, endDate: `${year}-06-${values[0][2].padStart(2,"0")}` };
}
export function download(input: string, source: FestivalSource) {
  if (!isDownloadSource(source)) return undefined;
  let data: { kind: string; home: string; artists: string };
  try { data = JSON.parse(input); } catch { return undefined; }
  if (data?.kind !== DOWNLOAD_DOCUMENTS || typeof data.home !== "string" || typeof data.artists !== "string") return undefined;
  const home = clean(data.home), artists = clean(data.artists);
  const d = dates(home, source.editionYear), a = dates(artists, source.editionYear);
  if (!d || !a || JSON.stringify(d) !== JSON.stringify(a)) return undefined;
  const bill = artists.match(/<nav\b[^>]*aria-label="Artist Listing"[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
  if (!bill) return undefined;
  const names: string[] = [];
  const anchors = [...bill.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  if (!anchors.length || anchors.length !== [...bill.matchAll(/class="artist grid-item\s/g)].length) return undefined;
  for (const m of anchors) {
    let url: URL;
    try { url = new URL(m[1], DOWNLOAD_HOME); } catch { return undefined; }
    if (url.origin !== new URL(DOWNLOAD_HOME).origin || url.search || url.hash || url.username || url.password || !/^\/artists-a-z\/[^/]+\/$/.test(url.pathname)) return undefined;
    const caption = m[2].match(/<div\b[^>]*class="artist-title\s*"[^>]*>([^<]+)<\/div>/i)?.[1];
    if (!caption) return undefined;
    const name = text(caption);
    if (!name || name.length > 100 || /&(?:#\d+|\w+);/.test(name) || names.some(n => n.toLowerCase() === name.toLowerCase())) return undefined;
    names.push(name);
  }
  const headings = [...home.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => text(m[1]));
  const headlines = headings.filter(s => / are your #DL[IVX]+ headliners$/.test(s));
  if (headlines.length !== 1) return undefined;
  const headliners = headlines[0].replace(/ are your #DL[IVX]+ headliners$/, "").split(/,\s*|\s+and\s+/);
  if (headliners.length < 1 || headliners.some(h => !names.includes(h))) return undefined;
  return { ...d, editionYear: source.editionYear, headliners, lineup: names.filter(n => !headliners.includes(n)), status: "partial" as const,
    lineupScope: "announcement" as const, artistListMode: "additive" as const, excerpt: headlines[0] + "; official Artist Listing: " + names.slice(0,8).join(", ") };
}
