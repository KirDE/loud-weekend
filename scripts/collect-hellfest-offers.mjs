import { pathToFileURL } from "node:url";
import { fetchHellfestOfferObservation } from "../lib/ingestion/hellfest-offer-collector.ts";
import {
  extractHellfestOfferProposals,
  isHellfestOfferTarget,
} from "../lib/ingestion/adapters/hellfest-offers.ts";
import { ticketOfferProposalSchema } from "../lib/domain/ticket-offer-review.ts";
import { stageHellfestOffers } from "../lib/ingestion/ticket-offer-proposal-store.ts";

export const usage =
  "npm run tickets:collect-hellfest -- --year=YYYY [--stage-pending --edition-id=ID]\n" +
  "Default: read-only preview, no DB connection. Staging requires explicit DATABASE_URL " +
  "and an existing matching current edition. Never approves, migrates or changes global ticket status.";
export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const values = new Map();
  for (const arg of args) {
    const match = /^(--year|--edition-id)=(.+)$/.exec(arg);
    const key = match?.[1] ?? arg;
    if ((!match && arg !== "--stage-pending") || values.has(key))
      throw new Error("Invalid arguments");
    values.set(key, match?.[2] ?? true);
  }
  const year = values.get("--year");
  const editionId = values.get("--edition-id");
  const stage = values.has("--stage-pending");
  if (
    !/^20\d{2}$|^2100$/.test(year ?? "") ||
    stage !== Boolean(editionId) ||
    (editionId && !/^[A-Za-z0-9_-]{1,128}$/.test(editionId))
  )
    throw new Error("Invalid arguments");
  return { year: Number(year), editionId, stage };
}

/** Explicit operator invocation. Injected DB/fetch are for isolated tests only;
 * no endpoint/HTML/time overrides are accepted by the CLI. */
export async function runCollection(args, { db, fetchImpl } = {}) {
  const options = parseArguments(args);
  if (options.help) return { help: usage };
  if (options.stage) {
    if (!db) throw new Error("Explicit database required");
    // Check target before external work; store rechecks under its edition lock.
    const edition = await db.festivalEdition.findUnique({
      where: { id: options.editionId },
      include: { festival: true },
    });
    if (
      !edition ||
      edition.year !== options.year ||
      edition.recordState !== "CURRENT" ||
      !isHellfestOfferTarget(edition.festival.slug, edition.festival.officialUrl)
    )
      throw new Error("Target mismatch");
  }
  const observation = await fetchHellfestOfferObservation({ fetchImpl });
  const proposal = ticketOfferProposalSchema.parse(
    extractHellfestOfferProposals({ ...observation, editionYear: options.year }),
  );
  if (!options.stage) return { mode: "preview", writes: false, proposal };
  const row = await stageHellfestOffers(db, { ...observation, editionId: options.editionId });
  return {
    mode: "staged_for_review",
    snapshotId: row.id,
    contentHash: row.contentHash,
    observedAt: row.observedAt.toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db;
  try {
    const args = process.argv.slice(2);
    const options = parseArguments(args);
    if (options.stage) {
      if (!process.env.DATABASE_URL) throw new Error("Explicit database required");
      const { createPrismaClient } = await import("../lib/prisma-client.mjs");
      db = createPrismaClient();
    }
    const result = await runCollection(args, { db });
    console.log(options.help ? result.help : JSON.stringify(result));
  } catch {
    // Never print DB URLs, driver diagnostics or raw HTTP documents.
    console.error(
      "hellfest_collection_failed: check arguments, explicit database, matching edition and source response; " +
        "no approval performed",
    );
    process.exitCode = 1;
  } finally {
    if (db) {
      try {
        await db.$disconnect();
      } catch {
        console.error("hellfest_database_disconnect_failed");
        process.exitCode = 1;
      }
    }
  }
}
