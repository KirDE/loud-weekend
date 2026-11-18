import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

// This source permits catalog-only additions. Provider refreshes are a separate,
// explicit operation; removing their blanket gate must not authorize billing edits.
export function isIdaysAnnouncement(candidate: FestivalCandidate, year: number | undefined): boolean {
  return candidate.festivalSlug === "idays" &&
    ["https://www.idays.it/", "https://www.idays.it/line-up"].includes(candidate.sourceUrl) &&
    candidate.artistListMode === "additive" && candidate.warnings.length === 0 &&
    candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === year &&
    !!candidate.headliners?.length &&
    (["headliners", "lineup"] as const).every(field => candidate[field] === undefined ||
      candidate.evidence.some(e => e.field === field && e.sourceUrl === candidate.sourceUrl));
}
const decode = (value: string) => value.replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
const text = (value: string) => decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "");
const validName = (value: string) => value.length > 0 && value.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,:!+?()/\-]*$/u.test(value) && !/\b(?:and more|biglietti|tickets|headliners|special guests|20\d{2})\b/i.test(value);


export function observeIdaysTicketStock(html: string, year: number): { status?: "available"; excerpt: string; warning?: string } {
  const $ = load(html);
  $("script, style, template, noscript, nav, header, footer, [hidden], [inert], [aria-hidden='true']").remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? "")) $(element).remove();
  });
  $("br").replaceWith(" ");
  const sections = $("section[id]");
  const copy = (selection: ReturnType<typeof $>) => {
    const node = selection.clone(); node.find("*").prepend(" ").append(" ");
    return text(node.text());
  };
  const months: Record<string,string> = {giugno:"06",luglio:"07",settembre:"09"};
  for (const element of sections.toArray()) {
    const intro = $(element), label = copy($(element)), id = intro.attr("id") ?? "";
    const date = id.match(/^(\d{1,2})-(giugno|luglio|settembre)$/);
    if (!date || !/l'acquisto del biglietto garantisce l'accesso al festival per l'intera giornata/i.test(label)) continue;
    const ordinaryCopy = label.replace(/Per questo show\s+i posti riservati nell'area dedicata alle persone con disabilità sono terminati\./gi," ");
    if (/\b(?:sold\s*out|esaurit[oi]|terminati|non (?:sono )?disponibili)\b/i.test(ordinaryCopy)) continue;
    // Actual source structure: dated concert intro, then its adjacent vendor
    // section. Never combine another concert's admission statement and CTA.
    const vendors = intro.next("section");
    if (!vendors.length || vendors.attr("id")) continue;
    for (const anchor of vendors.find("a[href]").toArray()) {
      const link = $(anchor);
      if (text(link.text()) !== "Acquista" || link.is("[disabled], [aria-disabled='true'], .Mui-disabled, .disabled")
        || link.parents("[disabled], [aria-disabled='true'], .Mui-disabled, .disabled").length) continue;
      try {
        const target = new URL(link.attr("href") ?? "");
        if (target.protocol !== "https:" || target.username || target.password || target.port || target.search || target.hash) continue;
        if (/merch|parking|vip|offsale/i.test(target.pathname)) continue;
        const day = date[1].padStart(2,"0"), month = months[date[2]];
        const ticketmaster = target.hostname === "www.ticketmaster.it"
          && new RegExp("^/biglietti/[a-z0-9-]*" + day + "-" + month + "-" + year + "/event/[a-z0-9]+$","i").test(target.pathname);
        const viva = target.hostname === "www.vivaticket.com"
          && /^\/it\/ticket\/[a-z0-9-]+\/\d+$/i.test(target.pathname)
          && target.pathname.includes("-i-days-milano-" + year + "/")
          && !/merch|parking|vip|offsale/i.test(target.pathname);
        if (!ticketmaster && !viva) continue;
        const card = link.closest("li");
        if (card.length && /\b(?:sold\s*out|esaurit[oi]|non disponibile)\b/i.test(copy(card))) continue;
        return { status:"available", excerpt:"I-Days " + year + "; ordinary festival-day admission " + id + "; enabled official Acquista: " + target.href };
      } catch { /* Foreign or malformed controls are not stock proof. */ }
    }
  }
  return {excerpt:"",warning:"I-Days review required: no verified visible current-edition general-admission purchase control"};
}

// The reviewed homepage hierarchy corresponds to the official /line-up
// HEADLINERS and SPECIAL GUESTS groups. Never extract navigation/biography
// prose, infer continuous dates from isolated concerts, or call a ticket CTA
// proof of availability. Supports future artists/years, not a frozen bill.
export function extractIdaysCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [], artistListMode: "additive" };
  const fail = (reason: string) => { candidate.warnings.push(`I-Days review required: ${reason}`); return candidate; };
  let url: URL;
  try { url = new URL(source.url); } catch { return fail("invalid source URL"); }
  if (source.festivalSlug !== "idays" || url.origin !== "https://www.idays.it" || !["/", "/line-up", "/tickets"].includes(url.pathname) || url.search || url.hash || url.username || url.password) return fail("unrecognized official source");
  const visible = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const sections = [...visible.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].map(m => m[0]);
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => { Object.assign(candidate, { [field]: value }); candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 1800) }); };
  if (url.pathname === "/tickets") {
    const observation = observeIdaysTicketStock(html, source.editionYear);
    if (!observation.status) return fail(observation.warning ?? "unverified festival-day inventory");
    add("ticketsUrl", "https://www.idays.it/tickets", observation.excerpt);
    add("ticketStatus", observation.status, observation.excerpt);
    candidate.observedEditionYears = [source.editionYear];
    return candidate;
  }
  const heading = sections.findIndex(s => /Scopri i protagonisti dell'edizione\s+(20\d{2})/i.test(text(s)));
  if (heading < 0) return fail("missing edition heading");
  const year = Number(text(sections[heading]).match(/Scopri i protagonisti dell'edizione\s+(20\d{2})/i)?.[1]);
  if (year !== source.editionYear) return fail(`official edition ${year} differs from configured edition`);
  const headliners: string[] = [], lineup: string[] = [], excerpts: string[] = [];
  const record = (target: string[], value: string) => {
    if (!validName(value)) throw new Error("unrecognized artist label");
    if (!target.some(n => n.toLowerCase() === value.toLowerCase())) target.push(value);
  };
  const cards = (section: string, primary: string[]) => {
    let count = 0;
    for (const m of section.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      if (!/\bMuiCardActionArea-root\b/.test(attr(m[0], "class"))) continue;
      const target = new URL(attr(m[0], "href"), source.url);
      if (target.origin !== url.origin || target.pathname !== "/tickets" || (url.pathname === "/" && !target.hash)) throw new Error("unexpected concert link");
      const names = [...m[0].matchAll(/<p\b[^>]*class=["'][^"']*\bMuiTypography-header3\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)];
      if (names.length !== 1) throw new Error("changed concert card");
      record(primary, text(names[0][1]));
      const support = text(m[0].match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? "");
      const known = support.replace(/(?:,\s*)?and more\.{0,3}$/i, "").trim();
      if (known && url.pathname === "/") for (const name of known.split(/\s*,\s*/)) record(lineup, name);
      excerpts.push(text(m[0])); count++;
    }
    return count;
  };
  try {
    if (url.pathname === "/") {
      if (!sections[heading + 1] || !cards(sections[heading + 1], headliners)) return fail("missing current concert cards");
    } else {
      // Billing is explicit even when the section headings are image-only.
      if (!/\/headliners[^/]*\.(?:png|webp)/i.test(sections[heading])) return fail("missing explicit headliner group");
      let supporting = false;
      for (const section of sections.slice(heading + 1)) {
        if (/\/special-guests[^/]*\.(?:png|webp)/i.test(section)) { supporting = true; continue; }
        const title = section.match(/<h2\b[^>]*data-variant=["']header3["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
        const image = title?.match(/<img\b[^>]*>/i)?.[0];
        if (image) {
          const name = attr(image, "alt").replace(/\.(?:png|webp)(?:\s*\(\d+\))?$/i, "").replace(/_$/, "");
          const id = attr(section.match(/<section\b[^>]*>/i)?.[0] ?? "", "id");
          const navigation = [...visible.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].find(m => id && attr(m[0], "href") === `#${id}`);
          const label = navigation ? text(navigation[0]) : name;
          // Logo filenames lose punctuation; the matching section navigation
          // supplies the exact display spelling, not a hardcoded identity.
          const identity = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
          record(supporting ? lineup : headliners, identity(label) === identity(name) ? label : name); excerpts.push(title!);
        } else if (supporting) cards(section, lineup);
      }
      if (!headliners.length) return fail("missing headliner artists");
    }
  } catch { return fail("artist/card structure changed"); }
  if (/\b(?:cancelled|canceled|annullat[oa]|cancellat[oa])\b/i.test(excerpts.join(" "))) return fail("cancellation announcement");
  if (lineup.some(name => headliners.some(head => head.toLowerCase() === name.toLowerCase()))) return fail("ambiguous headline/support billing");
  add("headliners", headliners, excerpts.join("; "));
  if (lineup.length) add("lineup", lineup.filter(n => !headliners.some(h => h.toLowerCase() === n.toLowerCase())), excerpts.join("; "));
  if (/and more\.{0,3}/i.test(excerpts.join(" "))) add("status", "partial", excerpts.join("; "));
  if (/<a\b[^>]*href=["']\/tickets(?:#[^"']*)?["']/i.test(visible)) add("ticketsUrl", "https://www.idays.it/tickets", "Official current edition concert ticket links");
  candidate.observedEditionYears = [year];
  return candidate;
}
