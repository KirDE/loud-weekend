import { collectTolminatorCandidate } from "../lib/ingestion/tolminator-stock-candidate.ts";

// Preview parses the seller response without a database. An explicit audit write never publishes.
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--record-attempt" && /^[a-f0-9]{7,40}$/.test(args[1]))) {
  console.error("Usage: tsx scripts/collect-tolminator-stock.ts [--record-attempt EXACT_COMMIT]");
  process.exitCode = 1;
} else {
  try {
    if (!args.length) {
      const candidate = await collectTolminatorCandidate({});
      console.log(JSON.stringify({ mode: "preview", candidate }));
    } else {
      if (!process.env.DATABASE_URL) throw new Error("Database required");
      const { createPrismaClient } = await import("../lib/prisma-client.mjs");
      const { recordTolminatorStockAttempt } = await import("../lib/ingestion/tolminator-stock-invocation.ts");
      const db = createPrismaClient();
      try {
        const outcome = await recordTolminatorStockAttempt(db, { sourceCommit: args[1] });
        console.log(JSON.stringify({ mode: "audit-only", ...outcome }));
        if (outcome.status === "FAILED") process.exitCode = 1;
      } finally { await db.$disconnect(); }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    console.error(/^Tolminator HTTP \d{3}$/.test(message) ? message : "Tolminator invocation failed; no verified refresh");
    process.exitCode = 1;
  }
}
