import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { importReviewedCamping } from "../catalog/camping-import.ts";
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

/** Re-read the organizer before applying the exact observation previewed. */
export async function collectReviewedCamping(
  db: PrismaClient,
  festivalSlug: string,
  editionYear: number,
  options: { approval?: string; actorLabel?: string; fetchImpl?: typeof fetch } = {},
) {
  if (
    !Object.hasOwn(campingSources, festivalSlug) ||
    !Number.isInteger(editionYear) ||
    editionYear < 2000 ||
    editionYear > 2099
  )
    throw new Error("A supported festival and edition year are required");
  const slug = festivalSlug as CampingSlug;
  const sourceUrl = campingSourceUrl(slug, editionYear);
  const html = await readCampingPage(sourceUrl, options.fetchImpl ?? fetch);
  const facts = parseCampingGuidance(html, slug, editionYear);
  if (!facts) throw new Error("No complete organizer camping evidence for this edition");
  const observation = { festivalSlug, editionYear, ...campingSources[slug], sourceUrl, facts };
  const fingerprint = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
  if (options.approval !== undefined && options.approval !== fingerprint)
    throw new Error("Organizer camping evidence changed since preview");
  const checkOnly = options.approval === undefined;
  const observedAt = new Date().toISOString();
  const checkedOn = observedAt.slice(0, 10);
  const record = { ...observation, checkedOn };
  const receipt = checkOnly
    ? undefined
    : {
        actorLabel: options.actorLabel,
        fingerprint,
        contentHash: createHash("sha256").update(html).digest("hex"),
        observedAt,
      };
  await importReviewedCamping(db, record, receipt);
  return { record, fingerprint, checkOnly };
}
