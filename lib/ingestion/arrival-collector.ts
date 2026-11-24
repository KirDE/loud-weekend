import { createHash } from "node:crypto";
import { arrivalObservation } from "../catalog/arrival-import.ts";
import { INGESTION_SCHEMA_VERSION, type IngestionResult } from "./types.ts";
import type { ConfiguredSource } from "../sources/repository.ts";
import {
  arrivalSources,
  arrivalSourceUrls,
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

export function registeredArrivalSource(source: {
  slug: string;
  year: number;
  url: string;
  parserKey: string | null;
}) {
  return (
    Object.hasOwn(arrivalSources, source.slug) &&
    source.parserKey === "manual_review" &&
    arrivalSourceUrls(source.slug as ArrivalSlug, source.year)[0] === source.url
  );
}

export function allowedArrivalEvidenceUrl(slug: string, year: number, url: string) {
  return (
    Object.hasOwn(arrivalSources, slug) &&
    arrivalSourceUrls(slug as ArrivalSlug, year).includes(url)
  );
}

/** Extract a review-only result for the registered, leased organizer source. */
export async function collectArrivalCandidate(
  source: ConfiguredSource,
  fetchImpl: typeof fetch = fetch,
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
  const urls = arrivalSourceUrls(slug, editionYear);
  const pages = await Promise.all(urls.map((url) => readArrivalPage(url, fetchImpl)));
  const wacken = slug === "wacken-open-air" ? parseWackenArrival(pages[0], editionYear) : undefined;
  const facts =
    slug === "graspop" ? parseGraspopArrival(pages[0], pages[1], editionYear) : wacken && [wacken];
  if (!facts) throw new Error("No complete organizer arrival evidence for this edition");

  const fetchedAt = new Date().toISOString();
  const arrival = arrivalObservation.parse({
    editionId,
    festivalSlug,
    editionYear,
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
        excerpt: facts[index].description.en,
        adapter: ARRIVAL_ADAPTER,
      })),
    },
    changes: [],
    publishable: false,
    reviewReasons: ["Arrival guidance requires protected importer review"],
  };
}
