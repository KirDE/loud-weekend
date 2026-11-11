import type { FestivalSource } from "../types.ts";

// The official Live Nation holding page has no announced festival facts. Match
// its semantic structure, not a frozen document hash; any announcement/template
// drift must return to review rather than clearing verified catalogue data.
function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function attribute(tag: string, name: string): string {
  // Tokenize complete attributes so data-src (or text inside a quoted value)
  // cannot impersonate the browser's actual src/viewBox/d attribute.
  const attributes = tag.replace(/^<[^\s/>]+/, "").matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  );
  for (const match of attributes) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return "";
}
// Verified generic language-selector globe geometry, not edition artwork.
const LANGUAGE_ICON_PATH = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2m6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56M12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96M4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56m2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8M12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96M14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2m.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56M16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2z';
export function firenzeRocks(html: string, source: FestivalSource) {
  const drift = { excerpt: "Firenze Rocks official page changed", warning: "Firenze Rocks holding page changed or is incomplete; review the official announcement before extracting facts" };
  if (!/<title\b[^>]*>\s*Home\s*\|\s*Firenze Rocks\s*<\/title>/i.test(html) ||
      !/<script\b[^>]*\bsrc=["'][^"']*\/holdingPage\/page-[^"']+["']/i.test(html) ||
      /["']@type["']\s*:\s*["'](?:MusicEvent|Festival|Event)["']/i.test(html)) return drift;
  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    const kind = attribute(meta[0], "name") || attribute(meta[0], "property");
    // The visually verified share card is generic branding too. Unknown image
    // metadata can be an image-only edition announcement even on this shell.
    if (/^(?:og:image|twitter:image)(?::(?:url|src|secure_url))?$/i.test(kind) &&
        attribute(meta[0], "content") !== "https://networksites.livenationinternational.com/networksites/vrudcnfc/firenze-rocks-share-image.jpg") return drift;
    if (["description", "og:description", "og:title", "twitter:description", "twitter:title"].includes(kind) &&
        attribute(meta[0], "content") !== "Home | Firenze Rocks") return drift;
  }
  const headers = [...html.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)];
  if (headers.length !== 1 || text(headers[0][1]) !== "Switch language. Current language is Italiano IT") return drift;
  // Accept only the observed shell elements, not an expanding media denylist.
  // New controls (including image inputs), responsive sources, SVG animation,
  // custom widgets and all other unknown elements must return to review.
  if (/<\/?(?!(?:header|div|nav|a|img|label|svg|path|span)(?=[\s/>]))[a-z][^>]*>/i.test(headers[0][0])) return drift;
  // Only the observed presentation-only declarations are known safe. Reject
  // unknown CSS rather than enumerating image functions (image-set, paint, ...).
  for (const tag of headers[0][0].matchAll(/<[a-z][^>]*>/gi)) {
    const declarations = attribute(tag[0], "style").split(";").map(value => value.trim()).filter(Boolean);
    if (!declarations.every(value => /^(?:color\s*:\s*transparent|--Paper-shadow\s*:\s*var\(\s*--mui-shadows-\d+\s*\)|--Paper-overlay\s*:\s*var\(\s*--mui-overlays-\d+\s*\))$/i.test(value))) return drift;
  }
  const vectors = [...headers[0][1].matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)];
  if (vectors.length !== 1 || attribute(vectors[0][0], "viewBox") !== "0 0 24 24" ||
      !/^<svg\b[^>]*>\s*<path\b[^>]*>(?:\s*<\/path>)?\s*<\/svg>$/i.test(vectors[0][0]) ||
      attribute(vectors[0][0].match(/<path\b[^>]*>/i)?.[0] ?? "", "d") !== LANGUAGE_ICON_PATH ||
      /<\/?(?:svg|path|circle|rect|polygon|polyline|ellipse|line|text)\b/i.test(headers[0][1].replace(vectors[0][0], ""))) return drift;
  const logos = [...headers[0][1].matchAll(/<img\b[^>]*>/gi)];
  if (logos.length !== 2 || !logos.every(logo => {
    const years = [...logo[0].matchAll(/firenze-rocks-(20\d{2})_primary_black\.png/gi)];
    // Only this visually verified, yearless brand asset is known to be generic.
    // A different asset ID may contain a logo-only edition announcement, so
    // unknown replacements must return to review even when named logo.svg.
    const genericLogo = attribute(logo[0], "src") === "https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg";
    return attribute(logo[0], "alt") === "Site logo - www.firenzerocks.it - go to homepage" &&
      ((genericLogo && years.length === 0 && !/\bsrcset\s*=/i.test(logo[0])) || years.length > 0 && years.every(year => Number(year[1]) < source.editionYear));
  })) return drift;
  const mains = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  if (mains.length !== 1) return drift;
  let body = mains[0][1];
  if (/\bstyle\s*=\s*["'][^"']*(?:url\s*\(|background)/i.test(body)) return drift;
  // Legal footer text and annual copyright are not an edition announcement.
  body = body.replace(/<div\b[^>]*class=["']footer-copyright["'][^>]*>([\s\S]*?)<\/div>/gi, (block, contents: string) => {
    if (!/<(?:img|video|iframe|svg)\b/i.test(contents) && /^Copyright\s*©\s*20\d{2}\s+Firenze Rocks\. Tutti i diritti riservati\.$/i.test(text(contents))) return "";
    const legal = [...contents.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
    const expected = ["https://www.livenation.it/terms", "https://www.livenation.it/cookies", "https://www.livenation.it/privacy", "https://info.livenationinternational.com/accessibility-statement"];
    return !/<(?:img|video|iframe|svg)\b/i.test(contents) && legal.length === expected.length && legal.every((a, i) => attribute(a[0], "href") === expected[i]) &&
      text(contents) === "Termini e condizioni del sito | Informazioni sull'utilizzo del cookie | Privacy Policy | Accessibility Statement" ? "" : block;
  });
  const socials = [...body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
  const expectedSocials = ["https://www.facebook.com/firenzerocks/", "https://www.instagram.com/firenze_rocks/", "https://x.com/firenzerocks"];
  if (socials.length !== 3 || !socials.every((a, i) => {
    let link: URL;
    try { link = new URL(attribute(a[0], "href")); } catch { return false; }
    const images = [...a[0].matchAll(/<img\b[^>]*>/gi)];
    return link.origin + link.pathname === expectedSocials[i] && !link.username && !link.password &&
      images.length === 1 && ["width", "height"].every(key => Number(attribute(images[0][0], key)) > 0 && Number(attribute(images[0][0], key)) <= 70) &&
      /^(?:|Facebook|Instagram|X)$/i.test(attribute(images[0][0], "alt")) &&
      /^https:\/\/networksites\.livenationinternational\.com\/networksites\/[^/]+\/image\.png(?:\?|$)/i.test(attribute(images[0][0], "src")) && !text(a[0]);
  })) return drift;
  body = body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  const videos = [...body.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)];
  if (videos.length !== 1) return drift;
  const sources = [...videos[0][1].matchAll(/<source\b[^>]*>/gi)];
  if (sources.length !== 2 || !sources.every(s => /^https:\/\/networksites\.livenationinternational\.com\/networksites\/(?:k4tcpivz\/video-sito-mob|4jklndou\/video-sito-desk)\.mp4$/i.test(attribute(s[0], "src"))) ||
      text(videos[0][1])) return drift;
  body = body.replace(videos[0][0], "");
  // Unknown widgets, poster images, ticket links and even text-only announcements
  // are not a holding page. Do not guess facts or remove a partial lineup.
  if (/<\/?(?!h1\b|h3\b|section\b|div\b|p\b)[a-z][^>]*>/i.test(body) ||
      text(body) !== "Home | Firenze Rocks SEGUICI") return drift;
  return { noAnnouncement: true, excerpt: "Official Firenze Rocks holding page: generic video and social links only; no edition announcement" };
}
