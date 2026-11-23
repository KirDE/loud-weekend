import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { importReviewedVenue } from "../catalog/venue-import.ts";
import {
  brutalAssaultVenueSource,
  parseBrutalAssaultVenue,
} from "./adapters/brutal-assault-venue.ts";

async function readVenuePage(fetchImpl: typeof fetch) {
  const response = await fetchImpl(brutalAssaultVenueSource.sourceUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.url !== brutalAssaultVenueSource.sourceUrl ||
    response.redirected ||
    !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error("Unexpected organizer venue response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Organizer venue response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/** Preview or persist the exact parsed observation; never accept fact inputs. */
export async function collectReviewedVenue(
  db: PrismaClient,
  editionYear: number,
  options: { approval?: string; fetchImpl?: typeof fetch } = {},
) {
  if (!Number.isInteger(editionYear) || editionYear < 2000 || editionYear > 2099)
    throw new Error("A supported edition year is required");
  const html = await readVenuePage(options.fetchImpl ?? fetch);
  const observation = parseBrutalAssaultVenue(html, editionYear);
  if (!observation) throw new Error("No unambiguous organizer venue evidence for this edition");
  const record = {
    ...brutalAssaultVenueSource,
    editionYear,
    ...observation,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  if (options.approval !== undefined && options.approval !== fingerprint)
    throw new Error("Organizer venue evidence changed since preview");
  const checkOnly = options.approval === undefined;
  const checkedOn = new Date().toISOString().slice(0, 10);
  await importReviewedVenue(db, { ...record, checkedOn }, checkOnly);
  return { checkOnly, ...record, checkedOn, fingerprint };
}
