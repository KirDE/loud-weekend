import { observeTolminatorStock, TOLMINATOR_PRODUCT } from "./adapters/tolminator-stock.ts";

const maxBytes = 2_000_000;

/** Read-only, unregistered observer. Reuses the bounded public-document pattern
 * from the Hellfest collector: one GET, no redirects/retries/credentials, and a
 * deadline covering both headers and decompressed body. No DB/health mutation.
 * A rejected response never becomes an empty/available observation. */
export async function collectTolminatorStock(options: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
    throw new Error("Invalid Tolminator deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); reject(new Error("Tolminator document deadline exceeded"));
    }, timeoutMs);
  });
  try {
    response = await Promise.race([(options.fetchImpl ?? fetch)(TOLMINATOR_PRODUCT, {
      method: "GET", redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { accept: "text/html, application/xhtml+xml" },
    }), deadline]);
    // Status first: preserve an access failure as such, even without a final URL.
    if (response.status !== 200) throw new Error(`Tolminator HTTP ${response.status}`);
    if (response.url !== TOLMINATOR_PRODUCT || response.redirected)
      throw new Error("Tolminator response identity mismatch");
    const mime = response.headers.get("content-type") ?? "";
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(mime))
      throw new Error("Tolminator response is not HTML");
    // Decode strictly as UTF-8, never silently replace undecodable inventory.
    const charset = mime.match(/;\s*charset\s*=\s*([^;]+)/i)?.[1].trim().replace(/^"|"$/g, "");
    if (charset && !/^utf-?8$/i.test(charset)) throw new Error("Unsupported Tolminator charset");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))
      throw new Error("Tolminator document size unsupported");
    reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Tolminator document");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Tolminator document size unsupported");
      chunks.push(value);
    }
    if (!size) throw new Error("Empty Tolminator document");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const observedAt = new Date().toISOString();
    const observation = observeTolminatorStock(html, response.url, 2027, observedAt);
    if (observation.warning || observation.status !== "available" || observation.ticketsUrl !== TOLMINATOR_PRODUCT)
      throw new Error(observation.warning ?? "Tolminator ordinary stock not verified");
    // Only minimized source evidence escapes; no HTML, cookie or seller dates.
    return { ...observation, sourceUrl: TOLMINATOR_PRODUCT, editionYear: 2027 as const, observedAt };
  } finally {
    clearTimeout(timer!);
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
    controller.abort();
  }
}
