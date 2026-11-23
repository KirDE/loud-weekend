import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { importReviewedOverview } from "../catalog/festival-overview-import.ts";
import { overviewOrganizer, parseFestivalOverview } from "./adapters/festival-overview.ts";

async function readPage(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.url !== url ||
    response.redirected ||
    !response.body ||
    !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
  ) {
    await response.body?.cancel();
    throw new Error("Unexpected organizer overview response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let html = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return html + decoder.decode();
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Organizer overview response exceeds size limit");
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

export async function collectReviewedOverview(
  db: PrismaClient,
  festivalSlug: string,
  editionYear: number,
  options: { approval?: string; fetchImpl?: typeof fetch } = {},
) {
  const source = overviewOrganizer(festivalSlug, editionYear);
  if (!source) throw new Error("A supported festival and edition year are required");
  const { url, ...identity } = source;
  const html = await readPage(url, options.fetchImpl ?? fetch);
  const summary = parseFestivalOverview(html, festivalSlug, editionYear);
  if (!summary) throw new Error("No complete organizer overview evidence for this edition");
  const observation = { festivalSlug, editionYear, ...identity, sources: [url], summary };
  const fingerprint = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
  if (options.approval !== undefined && options.approval !== fingerprint) {
    throw new Error("Organizer overview evidence changed since preview");
  }
  const checkOnly = options.approval === undefined;
  const record = { ...observation, checkedOn: new Date().toISOString().slice(0, 10) };
  await importReviewedOverview(db, record, checkOnly);
  return { record, fingerprint, checkOnly };
}
