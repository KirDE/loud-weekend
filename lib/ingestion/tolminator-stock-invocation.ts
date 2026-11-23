import type { PrismaClient } from "@prisma/client";
import { readCatalog } from "../catalog/repository.ts";
import { collectTolminatorCandidate } from "./tolminator-stock-candidate.ts";
import { TOLMINATOR_PRODUCT } from "./adapters/tolminator-stock.ts";
import { evaluateCandidate } from "./policy.ts";
import { createIngestionRun, finishIngestionRun, ingestionQueries, persistAttempt } from "./repository.ts";

/** Explicit manual audit ingestion only. No canonical publication, source
 * registration, slug-file hydration, provider work or primary-health update. */
export async function recordTolminatorStockAttempt(db: PrismaClient, options: {
  sourceCommit: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}) {
  if (!/^[a-f0-9]{7,40}$/.test(options.sourceCommit)) throw new Error("Exact source commit required");
  const catalog = await readCatalog({ database: db });
  const current = catalog.festivals.find(f => f.slug === "tolminator");
  if (!current || current.editionYear !== 2027 || current.officialUrl !== "https://tolminator.com/")
    throw new Error("Current reviewed Tolminator 2027 target required");
  const run = await createIngestionRun(db, { trigger: "MANUAL", sourceCommit: options.sourceCommit, totalSources: 1 });
  const startedAt = new Date();
  // Catch ONLY collection errors, never a DB failure and then fabricate a
  // second failure attempt for a possibly committed first write.
  let candidate;
  let error: string | undefined;
  let httpStatus: number | undefined;
  try {
    candidate = await collectTolminatorCandidate(options);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const http = /^Tolminator HTTP (\d{3})$/.exec(message);
    httpStatus = http ? Number(http[1]) : undefined;
    // Never persist or print arbitrary transport errors, URLs or tokens.
    error = http ? `Tolminator HTTP ${httpStatus}` : "Tolminator stock collection failed";
  }
  const endedAt = new Date();
  const attempt = await persistAttempt(db, {
    runId: run.id, festivalSlug: "tolminator", requestedUrl: TOLMINATOR_PRODUCT,
    ...(candidate ? { finalUrl: TOLMINATOR_PRODUCT, httpStatus: 200,
      result: evaluateCandidate(current, candidate) } : { httpStatus, error }),
    durationMs: endedAt.getTime() - startedAt.getTime(), startedAt, endedAt,
  });
  await finishIngestionRun(db, run.id);
  return {
    attemptId: attempt.id, status: attempt.status, error,
    // Own exact route only; never report primary-roster health as stock health.
    consecutiveFailures: await ingestionQueries.consecutiveFailures(db, "tolminator", TOLMINATOR_PRODUCT),
    lastSuccessfulExtraction: (await ingestionQueries.lastSuccessfulExtraction(db, "tolminator", TOLMINATOR_PRODUCT))?.observedAt.toISOString() ?? null,
  };
}
