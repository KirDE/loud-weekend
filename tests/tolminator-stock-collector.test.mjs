import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { collectTolminatorStock } from "../lib/ingestion/tolminator-stock-collector.ts";
import { TOLMINATOR_PRODUCT } from "../lib/ingestion/adapters/tolminator-stock.ts";
const fixture = readFileSync(
  new URL("./fixtures/ticket-status/tolminator-ordinary.html", import.meta.url),
  "utf8",
);
// Keep the transport fixture's offer window current without publishing its dates.
const html = fixture
  .replace("2026-07-23T00:00:00+02:00", "2020-01-01T00:00:00Z")
  .replace('2027-07-31T00:00:00+02:00"}', '2099-01-01T00:00:00Z"}');
function response(body = html, init = {}, url = TOLMINATOR_PRODUCT, redirected = false) {
  const result = new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
  Object.defineProperties(result, { url: { value: url }, redirected: { value: redirected } });
  return result;
}
const run = (res, options = {}) =>
  collectTolminatorStock({ fetchImpl: async () => res, ...options });
test("Tolminator one exact credential-free GET returns only minimized current evidence", async () => {
  const start = Date.now();
  let calls = 0;
  let signal;
  const result = await collectTolminatorStock({
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, TOLMINATOR_PRODUCT);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      assert.deepEqual(options.headers, { accept: "text/html, application/xhtml+xml" });
      signal = options.signal;
      return response();
    },
  });
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.equal(result.status, "available");
  assert.equal(result.editionYear, 2027);
  assert.ok(Date.parse(result.observedAt) >= start && Date.parse(result.observedAt) <= Date.now());
  assert.deepEqual(Object.keys(result).sort(), [
    "editionYear",
    "excerpt",
    "observedAt",
    "sourceUrl",
    "status",
    "ticketsUrl",
  ]);
  assert.equal(result.sourceUrl, TOLMINATOR_PRODUCT);
});
for (const status of [201, 204, 206, 301, 302, 403, 429, 500])
  test(`Tolminator preserves HTTP ${status} as failure without retries or parsing body`, async () => {
    let calls = 0;
    await assert.rejects(
      collectTolminatorStock({
        fetchImpl: async () => {
          calls++;
          return response([204, 304].includes(status) ? null : html, { status });
        },
      }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(calls, 1);
  });
for (const [name, res] of [
  ["foreign final URL", () => response(html, {}, "https://foreign.example/")],
  ["absent final URL", () => response(html, {}, "")],
  ["redirect flag", () => response(html, {}, TOLMINATOR_PRODUCT, true)],
  ["JSON MIME", () => response(html, { headers: { "content-type": "application/json" } })],
  [
    "MIME prefix confusion",
    () => response(html, { headers: { "content-type": "text/html-malicious" } }),
  ],
  [
    "missing MIME",
    () => {
      const r = response();
      r.headers.delete("content-type");
      return r;
    },
  ],
  [
    "unsupported charset",
    () => response(html, { headers: { "content-type": "text/html; charset=windows-1250" } }),
  ],
  [
    "oversize header",
    () => response(html, { headers: { "content-type": "text/html", "content-length": "2000001" } }),
  ],
  [
    "invalid length",
    () => response(html, { headers: { "content-type": "text/html", "content-length": "-1" } }),
  ],
  ["oversize stream", () => response("x".repeat(2_000_001))],
  ["empty stream", () => response("")],
  ["absent body", () => response(null)],
  ["invalid UTF8", () => response(new Uint8Array([0xc3, 0x28]))],
  ["challenge HTML", () => response("<title>Just a moment</title>")],
  ["stock absent despite price/buy", () => response(html.replace("In stock", "Unknown"))],
  ["metadata/body conflict", () => response(html.replace("</body>", "<p>Razprodano</p></body>"))],
])
  test(`Tolminator rejects ${name}`, async () => {
    await assert.rejects(run(res()));
  });
test("Tolminator rejects header and body stalls even when transport ignores abort", async () => {
  await assert.rejects(
    collectTolminatorStock({ timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }),
    /deadline/,
  );
  let canceled = false;
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      canceled = true;
      return new Promise(() => {});
    },
  });
  await assert.rejects(run(response(body), { timeoutMs: 10 }), /deadline/);
  assert.equal(canceled, true);
});
test("Tolminator propagates network and body read failures without a healthy result", async () => {
  await assert.rejects(
    collectTolminatorStock({
      fetchImpl: async () => {
        throw new Error("network refused");
      },
    }),
    /network refused/,
  );
  await assert.rejects(
    run(
      response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken body"));
          },
        }),
      ),
    ),
    /broken body/,
  );
});
test("Tolminator rejects invalid deadline before making any request", async () => {
  for (const timeoutMs of [0, -1, 20_001, Infinity, NaN, 1.5]) {
    await assert.rejects(
      collectTolminatorStock({
        timeoutMs,
        fetchImpl: () => {
          assert.fail("must not request");
        },
      }),
      /deadline/,
    );
  }
});
