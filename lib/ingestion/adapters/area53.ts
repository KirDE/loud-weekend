import type { FestivalSource } from "../types.ts";

// Visible card headings are authoritative; the first card has a stale image alt.
// The per-card image directory binds each booking to the requested edition.
export function area53(input: string, source: FestivalSource) {
  if (source.url !== "https://area53festival.at/de/") return undefined;
  const html = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!new RegExp(`Tickets\\s+${source.editionYear}\\s*<`).test(html)) return undefined;
  // Corroborate the purchase route against visible official ticket links.
  const ticketLinks = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].filter(
    (link) => /^Tickets(?:\s+\d{4})?$/i.test(link[2].replace(/<[^>]*>/g, "").trim()),
  );
  if (!ticketLinks.length) return undefined;
  const ticketsUrl = "https://area53festival.at/de/tickets";
  try {
    const urls = ticketLinks.map((link) => new URL(link[1], source.url).href);
    if (
      !urls.includes(ticketsUrl) ||
      urls.some((url) => ![ticketsUrl, "https://area53festival.at/tickets"].includes(url))
    )
      return undefined;
  } catch {
    return undefined;
  }
  const section = html.match(
    /<div\b[^>]*id="Bands"[^>]*>([\s\S]*?)<div\b[^>]*id="news"[^>]*>/i,
  )?.[1];
  if (!section || !/<hr\b/.test(section)) return undefined;
  const lineup: string[] = [];
  for (const card of section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bhref="https:\/\/area53festival\.at\/tickets"/.test(card[1])) return undefined;
    const heading = card[2].match(
      /<h2\b[^>]*class="[^"]*\bel-title\b[^"]*"[^>]*>([^<]+)<\/h2>/i,
    )?.[1];
    const image = card[2].match(/<img\b[^>]*\bsrc="([^ "]+)"/i)?.[1];
    if (!heading || !image?.startsWith(`/images/${source.editionYear}/`)) return undefined;
    const label = heading.replace(/&amp;/g, "&").trim();
    // Official guatala.jpg visibly names GUTALAX; its card heading has a typo.
    // Normalize that source spelling to reuse the existing artist identity.
    const name = label === "Guatalax" ? "Gutalax" : label;
    if (
      !name ||
      name.length > 100 ||
      /[<>]|&(?:#|[a-z]+;)|\p{C}|\b(?:tba|20\d{2})\b/iu.test(name) ||
      lineup.some((n) => n.toLowerCase() === name.toLowerCase())
    )
      return undefined;
    lineup.push(name);
  }
  if (!lineup.length || (section.match(/<h2\b/gi)?.length ?? 0) !== lineup.length) return undefined;
  return {
    editionYear: source.editionYear,
    lineup,
    status: "partial" as const,
    artistListMode: "additive" as const,
    lineupScope: "announcement" as const,
    ticketsUrl,
    excerpt: `Area 53 ${source.editionYear}: ${lineup.join(", ")}`,
  };
}
