import { collectTolminatorStock } from "./tolminator-stock-collector.ts";
import { TOLMINATOR_PRODUCT } from "./adapters/tolminator-stock.ts";
import type { FestivalCandidate } from "./types.ts";

/** Independent, unregistered ticket-only producer. A primary roster failure is
 * never replaced by this observation. No seller dates, artists or price escape. */
export async function collectTolminatorCandidate(
  options: Parameters<typeof collectTolminatorStock>[0],
): Promise<FestivalCandidate> {
  const observation = await collectTolminatorStock(options);
  return {
    schemaVersion: 1,
    festivalSlug: "tolminator",
    sourceUrl: TOLMINATOR_PRODUCT,
    fetchedAt: observation.observedAt,
    observedEditionYears: [2027],
    warnings: [],
    ticketStatus: "available",
    ticketsUrl: TOLMINATOR_PRODUCT,
    evidence: (["ticketStatus", "ticketsUrl"] as const).map((field) => ({
      field,
      sourceUrl: TOLMINATOR_PRODUCT,
      observedAt: observation.observedAt,
      excerpt: observation.excerpt,
    })),
  };
}
