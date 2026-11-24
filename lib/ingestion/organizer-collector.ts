import { collectArrivalCandidate, registeredArrivalSource } from "./arrival-collector.ts";
import { collectOverviewCandidate, registeredOverviewSource } from "./overview-collector.ts";
import { MissingOrganizerEvidence, readOrganizerPage } from "./organizer-page.ts";
import type { ConfiguredSource } from "../sources/repository.ts";

async function collectSharedCandidate(source: ConfiguredSource, fetchImpl: typeof fetch = fetch) {
  const html = await readOrganizerPage(source.url, fetchImpl);
  // Both adapters inspect the same bounded response; neither can fetch another document.
  const fromSamePage: typeof fetch = async (url) => {
    if (url !== source.url) throw new Error("Shared organizer adapter requested another source");
    const response = new Response(html, { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: source.url });
    return response;
  };
  const untilMissing = (error: unknown) => {
    if (!(error instanceof MissingOrganizerEvidence)) throw error;
    return null;
  };
  const [arrival, overview] = await Promise.all([
    collectArrivalCandidate(source, fromSamePage).catch(untilMissing),
    collectOverviewCandidate(source, fromSamePage).catch(untilMissing),
  ]);
  if (!arrival && !overview)
    throw new MissingOrganizerEvidence("No complete organizer evidence for this edition");
  if (!arrival) return overview!;
  if (!overview) return arrival;
  return {
    ...arrival,
    candidate: {
      ...arrival.candidate,
      overview: overview.candidate.overview,
      evidence: [...arrival.candidate.evidence, ...overview.candidate.evidence],
    },
    reviewReasons: [...arrival.reviewReasons, ...overview.reviewReasons],
  };
}

export function organizerReviewCollector(source: ConfiguredSource) {
  const identity = {
    slug: source.festivalSlug,
    year: source.editionYear,
    url: source.url,
    parserKey: source.parserKey,
  };
  const arrival = registeredArrivalSource(identity);
  const overview = registeredOverviewSource(identity);
  if (arrival && overview) return collectSharedCandidate;
  if (arrival) return collectArrivalCandidate;
  if (overview) return collectOverviewCandidate;
}
