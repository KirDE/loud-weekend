import type { PrismaClient } from "@prisma/client";
import { stageHellfestOffers } from "./ticket-offer-proposal-store.ts";

const url = "https://hellfest.fr/";
const maxBytes = 2_000_000;

/** One ordinary public GET, no redirects, retries, seller calls or credentials.
 * The deadline covers headers AND streaming the decompressed body. Errors never
 * become empty/healthy observations. Kept separate from the global-status runner.
 */
export async function fetchHellfestOfferObservation(options: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw new Error("Invalid Hellfest deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Hellfest document deadline exceeded")); }, timeoutMs);
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    response = await Promise.race([(options.fetchImpl ?? fetch)(url, {
      method: "GET", redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { accept: "text/html, application/xhtml+xml" },
    }), deadline]);
    if (response.status !== 200 || response.url !== url || response.redirected) throw new Error("Hellfest response identity/status mismatch");
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Hellfest response is not HTML");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("Hellfest document size unsupported");
    reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Hellfest document");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Hellfest document size unsupported");
      chunks.push(value);
    }
    if (!size) throw new Error("Empty Hellfest document");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { html, status: response.status, finalUrl: response.url, observedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer!);
    // Never wait indefinitely on a stalled/malicious stream's cancellation.
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
    controller.abort();
  }
}

/** Explicit pending staging only; no production runner or public publication.
 * Timestamp and provenance come from transport, not a caller-built offer batch.
 */
export async function collectPendingHellfestOffers(db: PrismaClient, editionId: string, options: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}) {
  const observation = await fetchHellfestOfferObservation(options);
  return stageHellfestOffers(db, { editionId, ...observation });
}
