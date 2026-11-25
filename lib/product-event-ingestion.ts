import { z } from "zod";
import { productEventNames } from "./product-events";

const productEvent = z
  .object({
    event: z.enum(productEventNames),
    locale: z.enum(["en", "de", "ru"]),
  })
  .strict();

const maxBytes = 128;
const maxPerMinute = 240;

export function createProductEventLimiter() {
  let window = -1;
  let requests = 0;
  return (now: number) => {
    const minute = Math.floor(now / 60_000);
    if (minute !== window) {
      window = minute;
      requests = 0;
    }
    if (requests >= maxPerMinute) return false;
    requests += 1;
    return true;
  };
}

export async function parseProductEvent(request: Request) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes) return undefined;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > maxBytes) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      bytes.set(value, length);
      length += value.length;
    }
    const result = productEvent.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}
