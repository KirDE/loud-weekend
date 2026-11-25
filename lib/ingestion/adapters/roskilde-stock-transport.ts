import { CookieJar } from "tough-cookie";
import { load } from "cheerio";
import {
  observeRoskildeStock,
  ROSKILDE_PRODUCTS_URL,
  ROSKILDE_STOCK_INITIALIZATION,
  ROSKILDE_STOCK_ROOT,
  ROSKILDE_STOCK_SOURCE,
} from "./roskilde-stock.ts";

const SELECT = `${ROSKILDE_STOCK_ROOT}/selectproductgroup`;
const LIMIT = 2_000_000;
const DEADLINE = 20_000;
const failure = () => new Error("Roskilde public stock transport not verified");

/** Read-only public shop initialization; a new private in-memory jar per call.
 * Only fixed GET routes, no form submission, quantity selection or cart access.
 * No raw server errors, cookies or session HTML escape this boundary.
 */
export async function collectRoskildeStock(
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const timeout = options.timeoutMs ?? DEADLINE;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > DEADLINE) throw failure();
  const fetcher = options.fetch ?? fetch;
  const controller = new AbortController();
  const jar = new CookieJar();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const guard = () => {
    if (expired) throw failure();
  };
  const work = async () => {
    const get = async (
      url: string,
      redirectAllowed: boolean,
    ): Promise<{ html: string; redirect?: string }> => {
      guard();
      const cookie = await jar.getCookieString(url);
      guard();
      if (cookie.length > 16_384) throw failure();
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        headers: {
          Accept: "text/html",
          "User-Agent":
            "LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });
      guard();
      // Native fetch reports the actual request URL even on manual redirects.
      if (response.url !== url || response.redirected) throw failure();
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 32 || cookies.some((c) => c.length > 4096)) throw failure();
      for (const c of cookies) {
        await jar.setCookie(c, url);
        guard();
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        const target = location ? new URL(location, url).href : "";
        await response.body?.cancel();
        if (!redirectAllowed || target !== SELECT) throw failure();
        return { html: "", redirect: target };
      }
      if (
        response.status !== 200 ||
        !/^text\/html(?:\s*;\s*charset\s*=\s*["']?utf-8["']?)?\s*$/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        throw failure();
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT)) {
        await response.body?.cancel();
        throw failure();
      }
      if (!response.body) throw failure();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          guard();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > LIMIT) throw failure();
          chunks.push(value);
        }
      } catch {
        void reader.cancel().catch(() => {});
        throw failure();
      } finally {
        reader.releaseLock();
        reader = undefined;
      }
      const html = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      return { html };
    };
    let init = await get(ROSKILDE_STOCK_ROOT, true);
    if (init.redirect) init = await get(SELECT, false);
    const $ = load(init.html);
    $("script, style, template, noscript, [hidden], [inert], [aria-hidden='true']").remove();
    $("[style]").each((_, el) => {
      if (
        /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\s*[;!]|$))/i.test(
          $(el).attr("style") ?? "",
        )
      )
        $(el).remove();
    });
    $(".hidden, .d-none, .u-hidden").remove();
    if (
      $("title").length !== 1 ||
      $("title").text().trim() !== "Roskilde Festival - Tickster" ||
      !$.text().includes(ROSKILDE_STOCK_INITIALIZATION) ||
      !/Partout/.test($.text())
    )
      throw failure();
    const { html } = await get(ROSKILDE_PRODUCTS_URL, false);
    guard();
    const fetchedAt = new Date().toISOString();
    return observeRoskildeStock(html, ROSKILDE_STOCK_SOURCE, fetchedAt, {
      status: 200,
      finalUrl: ROSKILDE_PRODUCTS_URL,
    });
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          void reader?.cancel().catch(() => {});
          reject(failure());
        }, timeout);
      }),
    ]);
  } catch {
    controller.abort();
    void reader?.cancel().catch(() => {});
    throw failure();
  } finally {
    if (timer) clearTimeout(timer);
    // Only memory is used; nothing is logged or persisted, even on failure.
    await jar.removeAllCookies();
  }
}
