import { createHash } from "node:crypto";
import type { FestivalSource } from "../types.ts";

// The official Live Nation holding page has no announced festival facts. Match
// its semantic structure, not a frozen document hash; any announcement/template
// drift must return to review rather than clearing verified catalogue data.
function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function attributes(tag: string) {
  // Tokenize complete attributes, not names inside quoted values or data-*.
  return [...tag.replace(/^<[^\s/>]+/, "").matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )];
}
function attribute(tag: string, name: string): string {
  for (const match of attributes(tag)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return "";
}
// Metadata consumers decode character references before interpreting keys.
// Decode numeric references (including omitted semicolons) and key punctuation;
// unfamiliar named references fail closed rather than bypassing classification.
function metadataKey(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]+)|(\d+));?|&(colon|lowbar|period);/gi,
    (_, hex: string, decimal: string, named: string) => {
      if (named) return ({colon: ":", lowbar: "_", period: "."} as Record<string, string>)[named.toLowerCase()];
      const code = parseInt(hex ?? decimal, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
    }).toLowerCase();
}
function onlyAttributes(tag: string, allowed: string[]): boolean {
  return attributes(tag).every(attr => allowed.includes(attr[1].toLowerCase()));
}
function knownAria(tag: string): boolean {
  return attributes(tag).every(attr => {
    const name = attr[1].toLowerCase(), value = attr[2] ?? attr[3] ?? attr[4] ?? "";
    if (!name.startsWith("aria-")) return true;
    if (name === "aria-label") return /^<(?:nav|a)\b/i.test(tag) &&
      ["Primario", "Switch language. Current language is Italiano"].includes(value);
    if (name === "aria-hidden") return /^<(?:svg|video)\b/i.test(tag) && value === "true";
    if (/^<a\b/i.test(tag) && attribute(tag, "data-testid") === "lang-selector") {
      return name === "aria-haspopup" && value === "menu" || name === "aria-expanded" && value === "false";
    }
    return false;
  });
}
// Only observed presentation-only CSS; unknown functions/properties may render artwork.
function safeStyles(markup: string): boolean {
  return [...markup.matchAll(/<[a-z][^>]*>/gi)].every(tag =>
    attribute(tag[0], "style").split(";").map(value => value.trim()).filter(Boolean).every(value =>
      /^(?:color\s*:\s*transparent|text-align\s*:\s*center|--Paper-shadow\s*:\s*var\(\s*--mui-shadows-\d+\s*\)|--Paper-overlay\s*:\s*var\(\s*--mui-overlays-\d+\s*\))$/i.test(value)));
}
// CSS comment syntax is active only outside strings and escaped characters.
function withoutCssComments(css: string): string | null {
  let result = "", quote = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "\\") {
      result += char;
      if (i + 1 < css.length) result += css[++i];
      continue;
    }
    if (quote) {
      if (/[\r\n\f]/.test(char)) return null;
      result += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; result += char; continue; }
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return null;
      result += " ";
      i = end + 1;
    } else result += char;
  }
  return quote ? null : result;
}
// Verified runtime styles include narrowly scoped clipped labels/disabled UI.
// Trust those complete stylesheets, not reusable hiding declarations or a whole
// document hash. Unknown CSS may only use non-concealing presentation rules.
const VERIFIED_INLINE_STYLES = new Set(["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "c282e5299fbd6e53650fe3a761438b868c98fd8e3b69fb59d158d25ecdbd8417", "da70efd079cf8b54617ca21178ea933cc5747f52183cd09fc247851eb93e3fc3", "9c9faa4a135236ca56032a963d629bd7821be2e233c531b5903b991b6cebd6c4"]);
function nonConcealingStyles(css: string): boolean {
  let valid = true;
  const rest = css.replace(/[^{}]+\{([^{}]*)\}/g, (_, body: string) => {
    if (!body.split(";").every(value => !value.trim() ||
        /^\s*(?:color\s*:\s*black|text-align\s*:\s*(?:left|center|right|justify)|display\s*:\s*(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|flow-root|contents|table|table-row|table-cell|list-item)|(?:visibility|content-visibility)\s*:\s*visible)\s*(?:!important\s*)?$/i.test(value))) valid = false;
    return "";
  });
  return valid && !rest.trim();
}
function legacyLogoUrl(value: string, editionYear: number): boolean {
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"));
    const year = url.pathname.match(/^\/networksites\/hp5a3tkz\/firenze-rocks-(20\d{2})_primary_black\.png$/i)?.[1];
    return url.origin === "https://networksites.livenationinternational.com" && !url.username && !url.password &&
      Boolean(year && Number(year) < editionYear) && [...url.searchParams].every(([key, val]) =>
        key === "format" ? /^(?:webp|png|jpe?g)$/.test(val) : key === "rmode" ? val === "max" :
        ["width", "height", "quality"].includes(key) && /^\d+$/.test(val));
  } catch { return false; }
}
function legacyLogo(tag: string, editionYear: number): boolean {
  if (!legacyLogoUrl(attribute(tag, "src"), editionYear)) return false;
  const srcset = attribute(tag, "srcset");
  return !srcset || srcset.split(",").every(candidate => {
    const match = candidate.trim().match(/^(\S+)(?:\s+(?:\d+(?:\.\d+)?x|[1-9]\d*w))?$/);
    return Boolean(match && legacyLogoUrl(match[1], editionYear));
  });
}
// Observed runtime module identities; deployment hashes/versions may change.
// A new module or arbitrary inline executable can render an announcement.
const RUNTIME_CHUNKS = new Set(["9361d2c7", "8210", "main-app", "app/layout", "b27dc69b", "fcf3a8d9", "8087", "3945", "app/render/%5BcacheKey%5D/layout", "1738", "4860", "9385", "3734", "5993", "1441", "2085", "446", "1897", "8818", "app/render/%5BcacheKey%5D/(header-none-footer-none)/layout", "322", "1744", "5800", "3529", "7602", "443", "4865", "4475", "8784", "3464", "3604", "6292", "4418", "2393", "4793", "2392", "1584", "3393", "7018", "app/render/%5BcacheKey%5D/(header-minimal-footer-none)/holdingPage/page", "3208", "6841", "app/render/%5BcacheKey%5D/(header-minimal-footer-none)/layout", "3998", "app/render/%5BcacheKey%5D/error", "3887", "app/render/%5BcacheKey%5D/not-found", "9235", "7878", "app/render/%5BcacheKey%5D/(header-minimal-footer-minimal)/layout", "polyfills", "webpack"]);
function knownScripts(html: string): boolean {
  const seen = new Set<string>();
  let flight = "";
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const opening = script[0].match(/^<script\b[^>]*>/i)?.[0] ?? "";
    const src = attribute(opening, "src"), body = script[1].trim();
    if (src) {
      const chunk = src.match(/^\/_next\/static\/chunks\/(.+)-[0-9a-f]{16}\.js(?:\?dpl=v\d+)?$/i)?.[1];
      if (!chunk || !RUNTIME_CHUNKS.has(chunk) || seen.has(src) || body) return false;
      seen.add(src);
      continue;
    }
    if (body === "(function(){var w=window;w.googletag=w.googletag||{};w.googletag.cmd=w.googletag.cmd||[]})();") continue;
    const push = body.match(/^(?:\(self\.__next_f=self\.__next_f\|\|\[\]\)|self\.__next_f)\.push\((\[[\s\S]*\])\);?$/)?.[1];
    if (!push) return false;
    try {
      const payload = JSON.parse(push);
      if (!(Array.isArray(payload) && (payload.length === 1 && payload[0] === 0 ||
          payload.length === 2 && payload[0] === 1 && typeof payload[1] === "string"))) return false;
      if (payload[0] === 1) flight += payload[1];
    } catch { return false; }
  }
  // Flight is renderable component data, not inert text. Only the observed
  // holding-state payload is verified; changed hydration content needs review.
  return !flight || createHash("sha256").update(flight).digest("hex") === "f5750d90746dd2ba010e8a6927b35f3c3c22e465151a581ff97292efb509cab5";
}
const HOLDING_STYLESHEETS = new Set(["953121c93d63aeb2", "1bc24c9b26800efe", "470e0ddd5157a6ab", "bcd231364c309110", "85a7aa97446b1504", "6c379b8375ebf05e", "e6e29e7637e3db23", "65f01281536209d0", "38164a05c11725c4", "8d7a477251838ad6", "0455e988f10f9aad", "ff57e92795d75fd7", "312192854491e11f", "4b1c4e0e9eb5f06f"]);
function knownLinks(html: string): boolean {
  return [...html.matchAll(/<link\b[^>]*>/gi)].every(link => {
    const rel = attribute(link[0], "rel").toLowerCase(), href = attribute(link[0], "href");
    if (/\s+on[a-z]+\s*=/i.test(link[0])) return false;
    if (rel === "stylesheet" || rel === "preload" && attribute(link[0], "as") === "style") {
      const css = href.match(/^\/_next\/static\/css\/([0-9a-f]{16})\.css(?:\?dpl=v\d+)?$/i)?.[1];
      return Boolean(css && HOLDING_STYLESHEETS.has(css));
    }
    if (rel === "preload" && attribute(link[0], "as") === "script") return /^\/_next\/static\/chunks\/webpack-[0-9a-f]{16}\.js(?:\?dpl=v\d+)?$/i.test(href);
    if (rel === "icon" || rel === "apple-touch-icon") return href === "data:," || href === "https://networksites.livenationinternational.com/networksites/fk2hygpj/fr-2025_48x48.png";
    return rel === "alternate" && href === "https://www.firenzerocks.it/en" && attribute(link[0], "hreflang") === "en-IT";
  });
}
// Verified generic language-selector globe geometry, not edition artwork.
const LANGUAGE_ICON_PATH = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2m6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56M12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96M4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56m2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8M12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96M14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2m.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56M16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2z';
// A narrow fail-closed lexer: comment openers are recognized only in data,
// never inside a quoted tag attribute or script/style/title raw text. Ambiguous
// or nonstandard comment forms require review rather than erasing evidence.
function withoutComments(html: string): string | null {
  let result = "", offset = 0;
  while (offset < html.length) {
    if (html.startsWith("<!--", offset)) {
      const end = html.indexOf("-->", offset + 4);
      if (end < 0) return null;
      const body = html.slice(offset + 4, end);
      if (body.startsWith(">") || body.startsWith("->") || body.includes("--")) return null;
      offset = end + 3;
      continue;
    }
    if (html[offset] !== "<") {
      result += html[offset++];
      continue;
    }
    // A literal less-than in data must not be erased by later tag cleanup.
    if (!/^<\/?[a-z!]/i.test(html.slice(offset, offset + 3))) return null;
    let end = offset + 1, quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) return null;
    const tag = html.slice(offset, end + 1);
    // Later shell checks use tag regexes, so do not allow delimiter-like
    // attribute data to be reinterpreted by any subsequent cleanup either.
    if (tag.includes("<!--") || tag.includes("-->")) return null;
    const name = tag.match(/^<([a-z][\w:-]*)\b/i)?.[1];
    // Only empty runtime nodes may be hidden, never a required shell region
    // or an ancestor that would make all its evidence invisible.
    if (name && attributes(tag).some(attr => attr[1].toLowerCase() === "hidden") &&
        !new RegExp(`^</${name}\\s*>`, "i").test(html.slice(end + 1).replace(/^(?:\s|<!--\/?\$-->)+/, ""))) return null;
    result += tag;
    offset = end + 1;
    const raw = tag.match(/^<(script|style|title)\b/i)?.[1];
    if (raw) {
      const close = new RegExp(`<\\/${raw}\\s*>`, "ig");
      close.lastIndex = offset;
      const match = close.exec(html);
      if (!match) return null;
      result += html.slice(offset, close.lastIndex);
      offset = close.lastIndex;
    }
  }
  return result;
}
function knownNoscript(block: string): boolean {
    const frame = block.match(/^<noscript\b[^>]*>\s*(<iframe\b[^>]*>)\s*<\/iframe>\s*<\/noscript>$/i)?.[1];
    return Boolean(frame && safeStyles(block) && onlyAttributes(block.match(/^<noscript\b[^>]*>/i)?.[0] ?? "", ["id", "class", "style"]) &&
      onlyAttributes(frame, ["src", "width", "height", "title"]) &&
      ["", "gtm-GTM-NV6L247"].includes(attribute(frame, "title")) &&
      attribute(frame, "src") === "https://www.googletagmanager.com/ns.html?id=GTM-NV6L247" &&
      attribute(frame, "width") === "0" && attribute(frame, "height") === "0");
}
export function firenzeRocks(html: string, source: FestivalSource) {
  const drift = { excerpt: "Firenze Rocks official page changed", warning: "Firenze Rocks holding page changed or is incomplete; review the official announcement before extracting facts" };
  const cleaned = withoutComments(html);
  if (cleaned === null) return drift;
  html = cleaned;
  // Raw-text payloads are inspected separately, but are not DOM shell nodes.
  const rawTextExcluded = html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, "$1$3");
  const noscripts = [...rawTextExcluded.matchAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi)];
  if (noscripts.some(block => !knownNoscript(block[0]))) return drift;
  const structure = rawTextExcluded.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  const titles = [...structure.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1 || !/^\s*Home\s*\|\s*Firenze Rocks\s*$/i.test(titles[0][1]) ||
      !/<script\b[^>]*\bsrc=["'][^"']*\/holdingPage\/page-[^"']+["']/i.test(structure) ||
      /["']@type["']\s*:\s*["'](?:MusicEvent|Festival|Event)["']/i.test(html)) return drift;
  // Inspect inline CSS before head/runtime styles are removed. Generated layout
  // rules can change freely, but generated text, imports and artwork cannot.
  if (!knownScripts(html) || !knownLinks(structure)) return drift;
  const markup = structure;
  if ([...markup.matchAll(/<[a-z][^>]*>/gi)].some(tag => !knownAria(tag[0]) ||
      attributes(tag[0]).some(attr => /^(?:item(?:scope|type|prop|ref|id)|vocab|typeof|about|resource|prefix)$/i.test(attr[1]) ||
        /^on[a-z]/i.test(attr[1]) || /^(?:background|dynsrc|lowsrc|fill|stroke|filter|mask|clip-path|marker(?:-start|-mid|-end)?)$/i.test(attr[1])))) return drift;
  // Browsers reprocess invalid head children in the body. Do not discard them
  // merely because they are surrounded by raw head delimiters.
  for (const head of structure.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head>/gi)) {
    const remaining = head[1].replace(/<(script|style|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<meta\b[^>]*>|<link\b[^>]*>|<!--[\s\S]*?-->/gi, "");
    if (remaining.trim()) return drift;
  }
  for (const sheet of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const uncommented = withoutCssComments(sheet[1]);
    if (uncommented === null) return drift;
    const css = uncommented.replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
      (_, hex: string, char: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char);
    if (!VERIFIED_INLINE_STYLES.has(createHash("sha256").update(sheet[1]).digest("hex")) && !nonConcealingStyles(css)) return drift;
    if (/@(?:import|counter-style)\b|(?:^|[;{])\s*content\s*:|\b(?:url|(?:-webkit-)?image-set|image|paint|(?:-moz-)?element|symbols)\s*\(/i.test(css)) return drift;
    for (const declaration of css.matchAll(/(?:^|[;{])\s*([-\w]+)\s*:\s*([^;{}]*)/g)) {
      const property = declaration[1].toLowerCase(), value = declaration[2].trim().toLowerCase().replace(/\s*!important$/, "").trim();
      // Unknown visibility/display values can hide every required shell node.
      if (property === "display" && !/^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|flow-root|contents|table|table-row|table-cell|list-item)$/.test(value) ||
          /^(?:visibility|content-visibility)$/.test(property) && value !== "visible") return drift;
      if (/^(?:list-style-type|background(?:-image)?|border-image(?:-source)?|mask(?:-image)?|list-style(?:-image)?)$/i.test(declaration[1]) &&
          !(declaration[1].toLowerCase() === "background-image" && /^(?:none|var\(\s*--Paper-overlay\s*\))$/.test(declaration[2].trim()))) return drift;
    }
  }
  for (const meta of structure.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(meta[0], "http-equiv")) return drift;
    for (const kind of [attribute(meta[0], "name"), attribute(meta[0], "property")].map(metadataKey)) {
      if (kind.includes("&")) return drift;
      if (/^(?:og:image:alt|twitter:image:alt)$/.test(kind)) return drift;
      if (/^(?:og:(?:video|audio)|twitter:player)(?::|$)/.test(kind) ||
          kind === "twitter:card" && attribute(meta[0], "content").toLowerCase() === "player") return drift;
      // The visually verified share card is generic branding too. Unknown image
      // metadata can be an image-only edition announcement even on this shell.
      if (/^(?:og:image|twitter:image)(?::(?:url|src|secure_url))?$/i.test(kind) &&
          attribute(meta[0], "content") !== "https://networksites.livenationinternational.com/networksites/vrudcnfc/firenze-rocks-share-image.jpg") return drift;
      if (["description", "og:description", "og:title", "twitter:description", "twitter:title"].includes(kind) &&
          attribute(meta[0], "content") !== "Home | Firenze Rocks") return drift;
    }
  }
  const headers = [...structure.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)];
  if (headers.length !== 1 || text(headers[0][1]) !== "Switch language. Current language is Italiano IT") return drift;
  // Accept only the observed shell elements, not an expanding media denylist.
  // New controls (including image inputs), responsive sources, SVG animation,
  // custom widgets and all other unknown elements must return to review.
  if (/<\/?(?!(?:header|div|nav|a|img|label|svg|path|span)(?=[\s/>]))[a-z][^>]*>/i.test(headers[0][0])) return drift;
  if (!safeStyles(headers[0][0])) return drift;
  // The only controls are two home-logo links and the language selector.
  // Empty ticket anchors still carry official evidence through href/ARIA.
  const controls = [...headers[0][1].matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
  if (controls.length !== 3 || !controls.every((control, i) => {
    const opening = control[0].match(/^<a\b[^>]*>/i)?.[0] ?? "";
    if (i < 2) return attribute(opening, "href") === "/" &&
      /^<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>$/i.test(control[0]);
    return !attribute(opening, "href") && attribute(opening, "data-testid") === "lang-selector" &&
      attribute(opening, "aria-label") === "Switch language. Current language is Italiano";
  })) return drift;
  for (const tag of headers[0][0].matchAll(/<[a-z][^>]*>/gi)) {
    const expectedLabel = /^<nav\b/i.test(tag[0]) ? "Primario" :
      /^<a\b/i.test(tag[0]) && attribute(tag[0], "data-testid") === "lang-selector" ? "Switch language. Current language is Italiano" : "";
    if (attribute(tag[0], "aria-label") !== expectedLabel ||
        ["title", "aria-labelledby", "aria-describedby", "aria-description"].some(name => attribute(tag[0], name))) return drift;
  }
  const vectors = [...headers[0][1].matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)];
  // Geometry alone does not constrain paint servers or other presentation.
  // Keep both icon nodes limited to observed attributes, including inherited
  // paint attributes rejected globally above.
  if (vectors.length !== 1 ||
      !onlyAttributes(vectors[0][0].match(/^<svg\b[^>]*>/i)?.[0] ?? "", ["class", "focusable", "aria-hidden", "viewbox"]) ||
      !onlyAttributes(vectors[0][0].match(/<path\b[^>]*>/i)?.[0] ?? "", ["d"]) ||
      attribute(vectors[0][0], "viewBox") !== "0 0 24 24" ||
      !/^<svg\b[^>]*>\s*<path\b[^>]*>(?:\s*<\/path>)?\s*<\/svg>$/i.test(vectors[0][0]) ||
      attribute(vectors[0][0].match(/<path\b[^>]*>/i)?.[0] ?? "", "d") !== LANGUAGE_ICON_PATH ||
      /<\/?(?:svg|path|circle|rect|polygon|polyline|ellipse|line|text)\b/i.test(headers[0][1].replace(vectors[0][0], ""))) return drift;
  const logos = [...headers[0][1].matchAll(/<img\b[^>]*>/gi)];
  if (logos.length !== 2 || !logos.every(logo => {
    // Every browser-selected candidate must be the known generic brand or an
    // older-year official logo; an old fallback cannot approve an unknown srcset.
    const genericLogo = attribute(logo[0], "src") === "https://networksites.livenationinternational.com/networksites/u4lp0w3n/logo.svg";
    return attribute(logo[0], "alt") === "Site logo - www.firenzerocks.it - go to homepage" &&
      (genericLogo ? !attributes(logo[0]).some(attr => attr[1].toLowerCase() === "srcset") : legacyLogo(logo[0], source.editionYear));
  })) return drift;
  const mains = [...structure.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  if (mains.length !== 1) return drift;
  let body = mains[0][1];
  if (!safeStyles(mains[0][0])) return drift;
  if ([...mains[0][0].matchAll(/<[a-z][^>]*>/gi)].some(tag =>
    ["role", "aria-label", "title", "aria-labelledby", "aria-describedby", "aria-description"].some(name => attribute(tag[0], name)))) return drift;
  // Full responses also contain runtime wrappers, a GTM noscript and a skip
  // link. No other visible content outside the checked regions is known safe.
  let outside = structure.replace(headers[0][0], "").replace(mains[0][0], "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>|<meta\b[^>]*>|<link\b[^>]*>/gi, "");
  if (!safeStyles(outside)) return drift;
  outside = outside.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, block => {
    const skip = block.match(/^(<aside\b[^>]*>)\s*(<a\b[^>]*>)([^<]*)<\/a>\s*<\/aside>$/i);
    return skip && onlyAttributes(skip[1], ["id", "class", "style"]) &&
      onlyAttributes(skip[2], ["href", "id", "class", "style", "tabindex"]) &&
      attribute(skip[2], "href") === "#main" && text(skip[3]) === "Salta al contenuto principale" ? "" : block;
  }).replace(/<!--[\s\S]*?-->|<!doctype[^>]*>/gi, "");
  if (/<\/?(?!(?:html|body|div)(?=[\s/>]))[a-z][^>]*>/i.test(outside) || text(outside) ||
      [...outside.matchAll(/<[a-z][^>]*>/gi)].some(tag =>
        attributes(tag[0]).some(attr => !["id", "class", "style", "lang", "dir", "hidden", "data-dpl-id"].includes(attr[1].toLowerCase())))) return drift;
  // Legal footer text and annual copyright are not an edition announcement.
  body = body.replace(/<div\b[^>]*class=["']footer-copyright["'][^>]*>([\s\S]*?)<\/div>/gi, (block, contents: string) => {
    if (!/<[a-z]/i.test(contents) && /^Copyright\s*©\s*20\d{2}\s+Firenze Rocks\. Tutti i diritti riservati\.$/i.test(text(contents))) return "";
    const legal = [...contents.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
    const expected = ["https://www.livenation.it/terms", "https://www.livenation.it/cookies", "https://www.livenation.it/privacy", "https://info.livenationinternational.com/accessibility-statement"];
    return !/<[a-z]/i.test(contents.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")) &&
      legal.every(a => !/<[a-z]/i.test(a[1])) && legal.length === expected.length && legal.every((a, i) => attribute(a[0], "href") === expected[i]) &&
      text(contents) === "Termini e condizioni del sito | Informazioni sull'utilizzo del cookie | Privacy Policy | Accessibility Statement" ? "" : block;
  });
  const socials = [...body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
  const expectedSocials = ["https://www.facebook.com/firenzerocks/", "https://www.instagram.com/firenze_rocks/", "https://x.com/firenzerocks"];
  const expectedIcons = ["atlhchcy", "5rnlifmz", "vfhh3rto"];
  if (socials.length !== 3 || !socials.every((a, i) => {
    let link: URL;
    try { link = new URL(attribute(a[0], "href")); } catch { return false; }
    const images = [...a[0].matchAll(/<img\b[^>]*>/gi)];
    return link.origin + link.pathname === expectedSocials[i] && !link.username && !link.password &&
      /^<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>$/i.test(a[0]) &&
      images.length === 1 && !attribute(images[0][0], "srcset") && ["width", "height"].every(key => Number(attribute(images[0][0], key)) > 0 && Number(attribute(images[0][0], key)) <= 70) &&
      /^(?:|Facebook|Instagram|X)$/i.test(attribute(images[0][0], "alt")) &&
      new RegExp(`^https://networksites\\.livenationinternational\\.com/networksites/${expectedIcons[i]}/image\\.png(?:\\?|$)`, "i").test(attribute(images[0][0], "src")) && !text(a[0]);
  })) return drift;
  body = body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  const videos = [...body.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)];
  if (videos.length !== 1) return drift;
  const videoTag = videos[0][0].match(/^<video\b[^>]*>/i)?.[0] ?? "";
  if (["src", "poster", "aria-label", "title"].some(name => attribute(videoTag, name)) ||
      videos[0][1].replace(/<source\b[^>]*>/gi, "").trim()) return drift;
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
