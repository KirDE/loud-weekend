import type { FestivalSource } from "../types.ts";
export const TOLMINATOR_HOME = "https://tolminator.com/en/";
export const TOLMINATOR_LINEUP = "https://tolminator.com/en/lineup/";
export const TOLMINATOR_DOCUMENTS = "tolminator-lineup-documents-v1";
export function isTolminatorSource(source: FestivalSource) {
  return (
    source.festivalSlug === "tolminator" &&
    source.url === TOLMINATOR_HOME &&
    source.strategies.includes("official_markup")
  );
}
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function dates(html: string) {
  const matches = [
    ...text(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")).matchAll(
      /(\d{1,2})\s+July\s*[-–—]\s*(\d{1,2})\s+August\s+(20\d{2})/gi,
    ),
  ];
  if (!matches.length) return undefined;
  const ranges = matches.map(
    (m) =>
      [
        Number(m[3]),
        `${m[3]}-07-${m[1].padStart(2, "0")}`,
        `${m[3]}-08-${m[2].padStart(2, "0")}`,
      ] as const,
  );
  if (new Set(ranges.map((r) => r.join("/"))).size !== 1) return undefined;
  const [year, startDate, endDate] = ranges[0];
  if (
    ![startDate, endDate].every((d) => {
      const value = new Date(`${d}T00:00:00Z`);
      return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === d;
    }) ||
    (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 10
  )
    return undefined;
  return { editionYear: year, startDate, endDate };
}
export function tolminator(document: string, source: FestivalSource) {
  let home = document,
    lineupPage: string | undefined;
  if (document.trimStart().startsWith("{")) {
    if (!isTolminatorSource(source)) return undefined;
    try {
      const bundle = JSON.parse(document);
      if (
        bundle.kind !== TOLMINATOR_DOCUMENTS ||
        typeof bundle.home !== "string" ||
        typeof bundle.lineup !== "string"
      )
        return undefined;
      home = bundle.home;
      lineupPage = bundle.lineup;
    } catch {
      return undefined;
    }
  }
  const range = dates(home);
  if (!range || range.editionYear !== source.editionYear) return undefined;
  if (!lineupPage) return { ...range, excerpt: `${range.startDate} – ${range.endDate}` };
  if (JSON.stringify(dates(lineupPage)) !== JSON.stringify(range)) return undefined;
  const lineup: string[] = [],
    identities = new Map<string, string>();
  const clean = lineupPage
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  for (const card of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = card[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, TOLMINATOR_HOME);
    } catch {
      continue;
    }
    if (
      url.origin !== new URL(TOLMINATOR_HOME).origin ||
      !/^\/en\/band\/[a-z0-9-]+\/$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      continue;
    const heading = card[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    if (!heading) continue;
    const name = text(heading);
    // An artist link alone is not edition evidence; require its current-edition card image.
    if (!card[2].includes(`Tolminator${range.editionYear}_`) || !name || name.length > 120)
      return undefined;
    const prior = identities.get(url.pathname);
    if (prior && prior !== name) return undefined;
    if (!prior) {
      identities.set(url.pathname, name);
      if (!lineup.some((n) => n.toLocaleLowerCase() === name.toLocaleLowerCase()))
        lineup.push(name);
    }
  }
  if (!lineup.length) return undefined;
  return {
    ...range,
    lineup,
    lineupSourceUrl: TOLMINATOR_LINEUP,
    status: "partial" as const,
    lineupScope: "announcement" as const,
    artistListMode: "additive" as const,
    excerpt: `Tolminator ${range.editionYear}: ${range.startDate} – ${range.endDate}; ${lineup.join("; ")}`,
  };
}
