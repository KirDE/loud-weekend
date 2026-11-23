import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { importReviewedArrival } from "../catalog/arrival-import.ts";
import { arrivalSources, arrivalSourceUrls, parseGraspopArrival, parseWackenArrival, type ArrivalSlug } from "./adapters/arrival-guidance.ts";

async function readArrivalPage(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "text/html" },
  });
  if (response.status !== 200 || response.url !== url || response.redirected
    || !/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body) {
    await response.body?.cancel();
    throw new Error("Unexpected organizer arrival response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Organizer arrival response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/** Preview parsed arrival guidance or apply a matching reviewed observation. */
export async function collectReviewedArrival(
  db: PrismaClient,
  festivalSlug: string,
  editionYear: number,
  options: { approval?: string; fetchImpl?: typeof fetch } = {},
) {
  if (!Object.hasOwn(arrivalSources, festivalSlug) || !Number.isInteger(editionYear)
    || editionYear < 2000 || editionYear > 2099) throw new Error("A supported festival and edition year are required");
  const slug = festivalSlug as ArrivalSlug;
  const urls = arrivalSourceUrls(slug, editionYear);
  const pages = await Promise.all(urls.map(url => readArrivalPage(url, options.fetchImpl ?? fetch)));
  const wacken = slug === "wacken-open-air" ? parseWackenArrival(pages[0], editionYear) : undefined;
  const facts = slug === "graspop" ? parseGraspopArrival(pages[0], pages[1], editionYear) : wacken && [wacken];
  if (!facts) throw new Error("No complete organizer arrival evidence for this edition");
  const observation = {
    festivalSlug, editionYear, ...arrivalSources[slug],
    facts: facts.map((fact, index) => ({ ...fact, sourceUrl: urls[index] })),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
  if (options.approval !== undefined && options.approval !== fingerprint)
    throw new Error("Organizer arrival evidence changed since preview");
  const checkedOn = new Date().toISOString().slice(0, 10);
  const record = { ...observation, facts: observation.facts.map(fact => ({ ...fact, checkedOn })) };
  const checkOnly = options.approval === undefined;
  await importReviewedArrival(db, record, checkOnly);
  return { record, fingerprint, checkOnly };
}
