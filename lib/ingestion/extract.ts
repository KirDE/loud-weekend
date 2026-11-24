import { isBarcelonaSource } from "./adapters/barcelona-banner.ts";
import {
  observeTicketSupplement,
  ticketSupplementUrl,
  TICKET_SUPPLEMENT,
} from "./ticket-supplements.ts";
import { extractRoskildeCandidate } from "./adapters/roskilde.ts";
import { extractRoadburnCandidate } from "./adapters/roadburn.ts";
import { extractCopenhellCurrent } from "./adapters/copenhell-current.ts";
import { extractRockInRomaCandidate } from "./adapters/rock-in-roma.ts";
import { extractAlpenFlairCandidate } from "./adapters/alpen-flair.ts";
import { extractInfernoCandidate } from "./adapters/inferno.ts";
import { extractFrequencyCandidate } from "./adapters/frequency.ts";
import { extractPaleoCandidate } from "./adapters/paleo.ts";
import { extractLeedsCandidate } from "./adapters/leeds.ts";
import { isFullForceArchivedEdition } from "./adapters/full-force-archive.ts";
import { extractReadingCandidate } from "./adapters/reading.ts";
import { isRockImperiumSource, extractRockImperiumCandidate } from "./adapters/rock-imperium.ts";
import { isMadCoolArchivedEdition } from "./adapters/mad-cool-archive.ts";
import { isPistoiaBluesArchivedEdition } from "./adapters/pistoia-blues-archive.ts";
import { extractHtmlFallbackCandidate } from "./adapters/html-fallback.ts";
import { extractJsonLdCandidate } from "./adapters/json-ld.ts";
import { extractOfficialMarkupCandidate } from "./adapters/official-markup.ts";
import { isArchivedRockEnSeineDocument } from "./adapters/rock-en-seine.ts";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { announcementCoverageWarning } from "./announcement-watch.ts";

const missingFormatWarnings = new Set([
  "No JSON-LD Event was found",
  "HTML fallback did not find explicitly marked festival fields",
]);

// Only a verified supplemental ticket status can replace a missing homepage summary.
const supplementalFormatWarnings = new Set([
  ...missingFormatWarnings,
  "Sweden Rock current ticket summary was not found",
]);

const supportedFields: FieldEvidence["field"][] = [
  "startDate",
  "endDate",
  "city",
  "headliners",
  "lineup",
  "ticketsUrl",
  "status",
  "ticketStatus",
];

function extractCatalogueCandidate(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate {
  const candidate = extractConfiguredCandidate(html, source, fetchedAt);
  const warning = announcementCoverageWarning(html, source, candidate);
  return warning
    ? { ...candidate, warnings: [...new Set([...candidate.warnings, warning])] }
    : candidate;
}

function extractConfiguredCandidate(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate {
  const barcelona = source.festivalSlug === "barcelona-rock-fest";
  if (barcelona && !isBarcelonaSource(source)) {
    return {
      schemaVersion: INGESTION_SCHEMA_VERSION,
      festivalSlug: source.festivalSlug,
      sourceUrl: source.url,
      fetchedAt,
      evidence: [],
      observedEditionYears: [],
      warnings: ["Barcelona source identity is not the reviewed homepage"],
    };
  }
  const roskilde = extractRoskildeCandidate(html, source, fetchedAt);
  if (roskilde) return roskilde;
  const roadburn = extractRoadburnCandidate(html, source, fetchedAt);
  if (roadburn) return roadburn;
  const copenhell = extractCopenhellCurrent(html, source, fetchedAt);
  if (copenhell) return copenhell;
  if (isRockImperiumSource(source)) return extractRockImperiumCandidate(html, source, fetchedAt);
  // Summer Breeze's existing HTML source mixes archived news, a navigation filter
  // and current metadata. Its trusted fallback owns the result; generic Event or
  // container guesses must not overwrite verified partial artists/billing.
  if (source.festivalSlug === "summer-breeze" && source.strategies.includes("html_fallback"))
    return extractHtmlFallbackCandidate(html, source, fetchedAt);
  if (source.strategies.includes("html_fallback")) {
    const roma = extractRockInRomaCandidate(html, source, fetchedAt);
    if (roma) return roma;
    const alpen = extractAlpenFlairCandidate(html, source, fetchedAt);
    if (alpen) return alpen;
    const inferno = extractInfernoCandidate(html, source, fetchedAt);
    if (inferno) return inferno;
    const frequency = extractFrequencyCandidate(html, source, fetchedAt);
    if (frequency) return frequency;
    const paleo = extractPaleoCandidate(html, source, fetchedAt);
    if (paleo) return paleo;
    const leeds = extractLeedsCandidate(html, source, fetchedAt);
    if (leeds) return leeds;
  }
  // A successful probe of an explicitly archived edition is a no-op, not a
  // fresh ticket proposal or another agent review. A current JSON-LD Event
  // takes precedence when the publisher has not yet refreshed its page title.
  if (
    source.festivalSlug === "rock-en-seine" &&
    source.strategies.includes("html_fallback") &&
    isArchivedRockEnSeineDocument(html, source.editionYear)
  ) {
    const event = source.strategies.includes("json_ld_event")
      ? extractJsonLdCandidate(html, source, fetchedAt)
      : undefined;
    if (event?.observedEditionYears.includes(source.editionYear)) return event;
    return {
      schemaVersion: INGESTION_SCHEMA_VERSION,
      festivalSlug: source.festivalSlug,
      sourceUrl: source.url,
      fetchedAt,
      evidence: [],
      warnings: [],
      observedEditionYears: [],
    };
  }
  if (source.strategies.includes("html_fallback")) {
    const reading = extractReadingCandidate(html, source, fetchedAt);
    if (reading) return reading;
  }
  // Alcatraz mixes the current banner with an archived bill and ticket terms.
  // Its trusted fallback owns this existing source, not generic Event guesses.
  if (source.festivalSlug === "alcatraz" && source.strategies.includes("html_fallback"))
    return extractHtmlFallbackCandidate(html, source, fetchedAt);
  // Scoped source DOM owns stock, including absence/conflicts; generic
  // Event offers cannot restore unavailable or uncorroborated stock.
  if (source.festivalSlug === "masters-of-rock" && source.strategies.includes("html_fallback"))
    return extractHtmlFallbackCandidate(html, source, fetchedAt);
  const strategies =
    barcelona && source.strategies.includes("html_fallback")
      ? ([
          "html_fallback",
          ...source.strategies.filter((strategy) => strategy !== "html_fallback"),
        ] as const)
      : source.strategies;
  const candidates = strategies.flatMap((strategy) => {
    if (strategy === "html_fallback")
      return [extractHtmlFallbackCandidate(html, source, fetchedAt)];
    if (strategy === "json_ld_event" || strategy === "official_markup") {
      const candidate =
        strategy === "json_ld_event"
          ? extractJsonLdCandidate(html, source, fetchedAt)
          : extractOfficialMarkupCandidate(html, source, fetchedAt);
      // Preserve non-ticket fields and cancellation warnings; only the
      // corroborated visible banner may establish Barcelona ticket stock.
      if (barcelona) {
        delete candidate.ticketsUrl;
        delete candidate.ticketStatus;
        candidate.evidence = candidate.evidence.filter(
          ({ field }) => field !== "ticketsUrl" && field !== "ticketStatus",
        );
      }
      return [candidate];
    }
    if (
      strategy === "manual_review" &&
      (isFullForceArchivedEdition(html, source) ||
        isMadCoolArchivedEdition(html, source) ||
        isPistoiaBluesArchivedEdition(html, source))
    )
      return [
        {
          schemaVersion: INGESTION_SCHEMA_VERSION,
          festivalSlug: source.festivalSlug,
          sourceUrl: source.url,
          fetchedAt,
          evidence: [],
          warnings: [],
          observedEditionYears: [],
        },
      ];
    if (strategy === "manual_review")
      return [
        {
          schemaVersion: INGESTION_SCHEMA_VERSION,
          festivalSlug: source.festivalSlug,
          sourceUrl: source.url,
          fetchedAt,
          evidence: [],
          warnings: [
            `Manual review only: ${source.manualReviewReason ?? "no trustworthy automated extraction path"}`,
          ],
          observedEditionYears: [],
        },
      ];
    return [];
  });
  const merged: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };
  for (const candidate of candidates) {
    if (candidate.artistListMode) merged.artistListMode = candidate.artistListMode;
    for (const field of supportedFields) {
      if (merged[field] === undefined && candidate[field] !== undefined)
        Object.assign(merged, { [field]: candidate[field] });
    }
    if (candidate.lineupScope && merged.lineup === candidate.lineup)
      merged.lineupScope = candidate.lineupScope;
    merged.evidence.push(...candidate.evidence.filter(({ field }) => merged[field] !== undefined));
    merged.observedEditionYears.push(...candidate.observedEditionYears);
    merged.warnings.push(...candidate.warnings);
  }
  // Strategies are alternatives: an absent optional format is not a review
  // failure once another strategy supplied supported field evidence. Keep
  // all semantic warnings (edition drift, cancellations, lineup quality).
  if (merged.evidence.length > 0) {
    merged.warnings = merged.warnings.filter((warning) => !missingFormatWarnings.has(warning));
  }
  merged.evidence = merged.evidence.filter(
    ({ field }, index, values) =>
      values.findIndex((evidence) => evidence.field === field) === index,
  );
  merged.observedEditionYears = [...new Set(merged.observedEditionYears)];
  merged.warnings = [...new Set(merged.warnings)];
  // The JSON-LD format is optional for the verified Rock Werchter homepage.
  // Keep every actual parse/edition warning, and no-field cases still review.
  if (
    source.festivalSlug === "rock-werchter" &&
    merged.artistListMode === "additive" &&
    merged.startDate &&
    merged.endDate
  ) {
    merged.warnings = merged.warnings.filter((warning) => warning !== "No JSON-LD Event was found");
  }
  return merged;
}

export function extractFestivalCandidate(
  html: string,
  source: FestivalSource,
  fetchedAt: string,
): FestivalCandidate {
  if (!html.startsWith("{")) return extractCatalogueCandidate(html, source, fetchedAt);
  let envelope: { kind?: string; body?: unknown; ticket?: { url?: unknown; html?: unknown } };
  try {
    envelope = JSON.parse(html);
  } catch {
    return extractCatalogueCandidate(html, source, fetchedAt);
  }
  if (envelope.kind !== TICKET_SUPPLEMENT)
    return extractCatalogueCandidate(html, source, fetchedAt);
  if (
    !ticketSupplementUrl(source) ||
    typeof envelope.body !== "string" ||
    typeof envelope.ticket?.url !== "string" ||
    typeof envelope.ticket?.html !== "string"
  )
    return {
      schemaVersion: INGESTION_SCHEMA_VERSION,
      festivalSlug: source.festivalSlug,
      sourceUrl: source.url,
      fetchedAt,
      evidence: [],
      warnings: ["Invalid official ticket supplement"],
      observedEditionYears: [],
    };
  const candidate = extractCatalogueCandidate(envelope.body, source, fetchedAt);
  const ticket = observeTicketSupplement(
    envelope.ticket.html,
    source,
    envelope.ticket.url,
    candidate,
  );
  // A failed current ticket check must not publish an older stock assertion
  // from another format as if the current inventory had been verified.
  delete candidate.ticketStatus;
  candidate.evidence = candidate.evidence.filter((evidence) => evidence.field !== "ticketStatus");
  if (ticket.warning) candidate.warnings.push(ticket.warning);
  if (ticket.status) {
    candidate.ticketSupplement = {
      sourceUrl: source.url,
      ticketUrl: envelope.ticket.url,
      editionYear: source.editionYear,
    };
    candidate.ticketStatus = ticket.status;
    candidate.ticketsUrl = ticket.ticketsUrl ?? envelope.ticket.url;
    candidate.observedEditionYears = [
      ...new Set([...candidate.observedEditionYears, source.editionYear]),
    ];
    candidate.evidence = candidate.evidence.filter((evidence) => evidence.field !== "ticketsUrl");
    for (const field of ["ticketStatus", "ticketsUrl"] as const)
      candidate.evidence.push({
        field,
        sourceUrl: envelope.ticket.url,
        observedAt: fetchedAt,
        excerpt: ticket.excerpt,
      });
    // Supplemental evidence makes optional homepage formats unnecessary, but
    // semantic, edition, source-identity and artist/provider warnings still gate.
    candidate.warnings = candidate.warnings.filter(
      (warning) => !supplementalFormatWarnings.has(warning),
    );
  }
  return candidate;
}
