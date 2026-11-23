import type { PrismaClient } from "@prisma/client";
import { readCatalog } from "../catalog/repository.ts";
import { collectRoskildeStock } from "./adapters/roskilde-stock-transport.ts";
import { ROSKILDE_PRODUCTS_URL, ROSKILDE_STOCK_YEAR } from "./adapters/roskilde-stock.ts";
import { evaluateCandidate } from "./policy.ts";
import {
  createIngestionRun,
  finishIngestionRun,
  ingestionQueries,
  persistAttempt,
} from "./repository.ts";

/** Explicit manual audit ingestion only. No canonical publication, source
 * registration, slug-file hydration, provider work or primary-health update. */
export async function recordRoskildeStockAttempt(
  db: PrismaClient,
  options: {
    sourceCommit: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
) {
  if (!/^[a-f0-9]{7,40}$/.test(options.sourceCommit))
    throw new Error("Exact source commit required");
  const catalog = await readCatalog({ database: db });
  const current = catalog.festivals.find((f) => f.slug === "roskilde");
  if (
    !current ||
    current.editionYear !== ROSKILDE_STOCK_YEAR ||
    current.officialUrl !== "https://www.roskilde-festival.dk/"
  )
    throw new Error(`Current reviewed Roskilde ${ROSKILDE_STOCK_YEAR} target required`);
  const run = await createIngestionRun(db, {
    trigger: "MANUAL",
    sourceCommit: options.sourceCommit,
    totalSources: 1,
  });
  const startedAt = new Date();
  // Catch ONLY collection errors, never a DB failure and then fabricate a
  // second failure attempt for a possibly committed first write.
  let candidate;
  let error: string | undefined;
  try {
    candidate = await collectRoskildeStock(options);
  } catch {
    // Transport intentionally returns only a sanitized failure. Do not invent
    // an HTTP status for a partial multi-GET workflow or persist private errors.
    error = "Roskilde stock collection failed";
  }
  const endedAt = new Date();
  const attempt = await persistAttempt(db, {
    runId: run.id,
    festivalSlug: "roskilde",
    requestedUrl: ROSKILDE_PRODUCTS_URL,
    ...(candidate
      ? {
          finalUrl: ROSKILDE_PRODUCTS_URL,
          httpStatus: 200,
          result: evaluateCandidate(current, candidate),
        }
      : { error }),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    startedAt,
    endedAt,
  });
  await finishIngestionRun(db, run.id);
  return {
    attemptId: attempt.id,
    status: attempt.status,
    error,
    // Own exact route only; never report primary-roster health as stock health.
    consecutiveFailures: await ingestionQueries.consecutiveFailures(
      db,
      "roskilde",
      ROSKILDE_PRODUCTS_URL,
    ),
    lastSuccessfulExtraction:
      (
        await ingestionQueries.lastSuccessfulExtraction(db, "roskilde", ROSKILDE_PRODUCTS_URL)
      )?.observedAt.toISOString() ?? null,
  };
}
