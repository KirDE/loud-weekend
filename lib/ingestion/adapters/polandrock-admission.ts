import { load } from "cheerio";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

export const POLANDROCK_NEWSROOM = "https://newsroom.polandrockfestival.pl/";
/** Independent admission-only source. Never substitute this for a failed roster fetch. */
export function isPolandrockAdmissionSource(source: FestivalSource): boolean {
  return (
    source.festivalSlug === "polandrock" &&
    source.url === POLANDROCK_NEWSROOM &&
    source.strategies.includes("html_fallback") &&
    !source.fetchUrl &&
    !source.followLinkPattern
  );
}
const validDate = (value: string) => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

export function extractPolandrockAdmission(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate | undefined {
  if (!isPolandrockAdmissionSource(source)) return undefined;
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };
  const fail = () => {
    candidate.warnings.push(
      "Pol'and'Rock newsroom ordinary free admission or current edition could not be verified",
    );
    return candidate;
  };
  const $ = load(html);
  $('script,style,template,noscript,[hidden],[aria-hidden="true"]').remove();
  $("[style]").each((_, el) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr("style") ?? ""))
      $(el).remove();
  });
  const about = $("div.pr-boiler-plate");
  if (about.length !== 1) return fail();
  const paragraphs = about
    .find("p")
    .toArray()
    .map((p) => $(p).text().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim());
  const policy = paragraphs.filter(
    (p) =>
      /^Pol'and'Rock Festival\b/.test(p) && /\bFestiwal jest darmowy i niebiletowany\./.test(p),
  );
  const allText = paragraphs.join(" ");
  if (
    policy.length !== 1 ||
    /festiwal\s+(?:jest|będzie)\s+(?:płatny|biletowany)|festiwal\s+nie\s+jest\s+darmowy/i.test(
      allText,
    )
  )
    return fail();
  // Archived and next-edition dates coexist in the same paragraph. Only the
  // explicit future-tense festival sentence anchors this admission observation.
  const dates = [
    ...allText.matchAll(
      /\b(\d+)\. Pol'and'Rock Festival odbędzie się w dniach (\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{2}) (20\d{2}) roku\./g,
    ),
  ];
  if (dates.length !== 1) return fail();
  const [sentence, edition, first, last, month, year] = dates[0];
  const start = `${year}-${month}-${first.padStart(2, "0")}`,
    end = `${year}-${month}-${last.padStart(2, "0")}`;
  if (
    Number(edition) < 1 ||
    Number(year) !== source.editionYear ||
    !validDate(start) ||
    !validDate(end) ||
    end < start
  )
    return fail();
  candidate.observedEditionYears = [Number(year)];
  const add = (field: FieldEvidence["field"], value: string, excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt });
  };
  add("startDate", start, sentence);
  add("endDate", end, sentence);
  add("ticketStatus", "free", `Festiwal jest darmowy i niebiletowany. ${sentence}`);
  // No artist, completeness, inventory, price or ancillary ticket URL inference.
  return candidate;
}
