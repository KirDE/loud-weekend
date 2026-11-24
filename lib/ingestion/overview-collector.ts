import { createHash } from "node:crypto";
import { overviewObservation } from "../catalog/festival-overview-import.ts";
import { overviewOrganizer, parseFestivalOverview } from "./adapters/festival-overview.ts";
import { MissingOrganizerEvidence, readOrganizerPage } from "./organizer-page.ts";
import { INGESTION_SCHEMA_VERSION, type IngestionResult } from "./types.ts";
import type { ConfiguredSource } from "../sources/repository.ts";

export const OVERVIEW_ADAPTER = "festival-overview-v1";

export function registeredOverviewSource(source: {
  slug: string;
  year: number;
  url: string;
  parserKey: string | null;
}) {
  return (
    source.parserKey === "manual_review" &&
    overviewOrganizer(source.slug, source.year)?.url === source.url
  );
}

export async function collectOverviewCandidate(
  source: ConfiguredSource,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestionResult> {
  const { festivalSlug, editionYear, editionId, parserKey, url } = source;
  const organizer = overviewOrganizer(festivalSlug, editionYear);
  if (!editionId || parserKey !== "manual_review" || organizer?.url !== url) {
    throw new Error("Overview source is not registered for this edition");
  }

  const html = await readOrganizerPage(url, fetchImpl);
  const fetchedAt = new Date().toISOString();
  const summary = parseFestivalOverview(html, festivalSlug, editionYear);
  if (!summary)
    throw new MissingOrganizerEvidence("No complete organizer overview evidence for this edition");
  const overview = overviewObservation.parse({
    editionId,
    festivalSlug,
    editionYear,
    city: organizer.city,
    countryCode: organizer.countryCode,
    organizerHost: organizer.organizerHost,
    checkedOn: fetchedAt.slice(0, 10),
    sourceUrl: url,
    summary,
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
      overview,
      warnings: [],
      observedEditionYears: [editionYear],
      evidence: [
        {
          field: "overview",
          sourceUrl: url,
          observedAt: fetchedAt,
          contentHash: createHash("sha256").update(html).digest("hex"),
          excerpt: overview.summary.en,
          adapter: OVERVIEW_ADAPTER,
        },
      ],
    },
    changes: [],
    publishable: false,
    reviewReasons: ["Festival overview requires protected importer review"],
  };
}
