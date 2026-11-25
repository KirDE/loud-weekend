import { createHash } from "node:crypto";
import { campingObservation } from "../catalog/camping-import.ts";
import {
  campingSources,
  campingSourceUrl,
  parseCampingGuidance,
  type CampingSlug,
} from "./adapters/camping-guidance.ts";

async function readCampingPage(url: string, fetchImpl: typeof fetch) {
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
    throw new Error("Unexpected organizer camping response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Organizer camping response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

import { INGESTION_SCHEMA_VERSION, type IngestionResult } from "./types.ts";
import type { ConfiguredSource } from "../sources/repository.ts";

export const CAMPING_ADAPTER = "camping-guidance-v1";

export function registeredCampingSource(source: {
  slug: string;
  year: number;
  url: string;
  parserKey: string | null;
}) {
  return (
    source.parserKey === "manual_review" &&
    Object.hasOwn(campingSources, source.slug) &&
    campingSourceUrl(source.slug as CampingSlug, source.year) === source.url
  );
}

export async function collectCampingCandidate(
  source: ConfiguredSource,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestionResult> {
  const { festivalSlug, editionYear, editionId, url, parserKey } = source;
  if (
    !editionId ||
    !registeredCampingSource({ slug: festivalSlug, year: editionYear, url, parserKey })
  )
    throw new Error("Camping source is not registered for this edition");

  const slug = festivalSlug as CampingSlug;
  const html = await readCampingPage(url, fetchImpl);
  const fetchedAt = new Date().toISOString();
  const facts = parseCampingGuidance(html, slug, editionYear);
  if (!facts) throw new Error("No complete organizer camping evidence for this edition");
  const camping = campingObservation.parse({
    ...campingSources[slug],
    editionId,
    festivalSlug,
    editionYear,
    sourceUrl: url,
    checkedOn: fetchedAt.slice(0, 10),
    facts,
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
      camping,
      warnings: [],
      observedEditionYears: [editionYear],
      evidence: [
        {
          field: "camping",
          sourceUrl: url,
          observedAt: fetchedAt,
          contentHash: createHash("sha256").update(html).digest("hex"),
          excerpt: "Organizer camping guidance",
          adapter: CAMPING_ADAPTER,
        },
      ],
    },
    changes: [],
    publishable: false,
    reviewReasons: ["Festival camping requires protected importer review"],
  };
}
