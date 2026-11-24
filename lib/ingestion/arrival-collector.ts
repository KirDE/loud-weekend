import { createHash } from "node:crypto";
import { arrivalObservation } from "../catalog/arrival-import.ts";
import { INGESTION_SCHEMA_VERSION, type IngestionResult } from "./types.ts";
import type { ConfiguredSource } from "../sources/repository.ts";
import {
  arrivalSources,
  arrivalSourceUrls,
  graspopRailSources,
  graspopRailOrganizerStations,
  parseGraspopRailShuttle,
  parseGraspopArrival,
  parseWackenArrival,
  type ArrivalSlug,
} from "./adapters/arrival-guidance.ts";

async function readArrivalPage(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.url !== url ||
    response.redirected ||
    !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error("Unexpected organizer arrival response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Organizer arrival response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export const ARRIVAL_ADAPTER = "arrival-guidance-v1";

function guidanceDocumentUrls(slug: string, year: number, primary: string) {
  if (!Object.hasOwn(arrivalSources, slug)) return;
  const organizerUrls = arrivalSourceUrls(slug as ArrivalSlug, year);
  if (organizerUrls[0] === primary) return { urls: organizerUrls, rail: false };
  const railUrls = graspopRailSources(slug as ArrivalSlug);
  if (railUrls?.[0] === primary) return { urls: railUrls, rail: true };
}

export function registeredArrivalSource(source: {
  slug: string;
  year: number;
  url: string;
  parserKey: string | null;
}) {
  return (
    source.parserKey === "manual_review" &&
    !!guidanceDocumentUrls(source.slug, source.year, source.url)
  );
}

export function allowedArrivalEvidenceUrl(
  slug: string,
  year: number,
  primary: string,
  url: string,
) {
  return (
    guidanceDocumentUrls(slug, year, primary)?.urls.some((document) => document === url) ?? false
  );
}

/** Extract a review-only result for the registered, leased organizer source. */
export async function collectArrivalCandidate(
  source: ConfiguredSource,
  fetchImpl: typeof fetch = fetch,
  editionInterval?: { startDate?: string; endDate?: string },
): Promise<IngestionResult> {
  const { festivalSlug, editionYear, editionId, url } = source;
  if (
    !editionId ||
    !registeredArrivalSource({
      slug: festivalSlug,
      year: editionYear,
      url,
      parserKey: source.parserKey,
    })
  )
    throw new Error("Arrival source is not registered for this edition");
  const slug = festivalSlug as ArrivalSlug;
  const documents = guidanceDocumentUrls(slug, editionYear, url);
  if (!documents) throw new Error("Unknown arrival source");
  const { urls, rail } = documents;
  const startDate = editionInterval?.startDate;
  const endDate = editionInterval?.endDate;
  const interval = startDate && endDate ? { startDate, endDate } : undefined;
  if (rail && !interval) throw new Error("Rail guidance requires a verified edition interval");
  const primary = await readArrivalPage(url, fetchImpl);
  if (rail && !graspopRailOrganizerStations(primary))
    throw new Error("No organizer corroboration for the rail operator");
  const pages = [
    primary,
    ...(await Promise.all(urls.slice(1).map((url) => readArrivalPage(url, fetchImpl)))),
  ];
  const wacken = slug === "wacken-open-air" ? parseWackenArrival(pages[0], editionYear) : undefined;
  const shuttle =
    rail && interval
      ? parseGraspopRailShuttle(pages[0], pages[1], editionYear, interval)
      : undefined;
  const standard =
    slug === "graspop" ? parseGraspopArrival(pages[0], pages[1], editionYear) : wacken && [wacken];
  const facts = rail ? shuttle && [shuttle] : standard;
  if (!facts) throw new Error("No complete organizer arrival evidence for this edition");

  const fetchedAt = new Date().toISOString();
  const arrival = arrivalObservation.parse({
    editionId,
    festivalSlug,
    editionYear,
    ...(rail && { editionInterval: interval }),
    ...arrivalSources[slug],
    facts: facts.map((fact, index) => ({
      ...fact,
      sourceUrl: urls[index],
      checkedOn: fetchedAt.slice(0, 10),
    })),
  });
  const schemaVersion = INGESTION_SCHEMA_VERSION;
  return {
    schemaVersion,
    festivalSlug,
    sourceUrl: url,
    fetchedAt,
    candidate: {
      schemaVersion,
      festivalSlug,
      sourceUrl: url,
      fetchedAt,
      arrival,
      warnings: [],
      observedEditionYears: [editionYear],
      evidence: urls.map((sourceUrl, index) => ({
        field: "arrival",
        sourceUrl,
        observedAt: fetchedAt,
        contentHash: createHash("sha256").update(pages[index]).digest("hex"),
        excerpt: facts[rail ? 0 : index].description.en,
        adapter: ARRIVAL_ADAPTER,
      })),
    },
    changes: [],
    publishable: false,
    reviewReasons: ["Arrival guidance requires protected importer review"],
  };
}
