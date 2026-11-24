import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import {
  observeTicketSupplement,
  ticketSupplementUrl,
} from "../lib/ingestion/ticket-supplements.ts";
import { VAINSTREAM_STOCK } from "../lib/ingestion/vainstream-ticket-stock.ts";
import { parserSource } from "./support/parser-source.ts";
const source = parserSource("vainstream", { url: "https://vainstream.com/artists/" }),
  dates = { startDate: "2027-06-25", endDate: "2027-06-26" };
const fixture = readFileSync(
    new URL("./fixtures/ticket-status/vainstream-regular-stock.html", import.meta.url),
    "utf8",
  ),
  home = readFileSync(
    new URL("./fixtures/official-markup/vainstream-excerpt.html", import.meta.url),
    "utf8",
  );
test("Vainstream: real current regular admission InStock plus enabled quantity/buy controls", () => {
  const o = observeTicketSupplement(fixture, source, VAINSTREAM_STOCK, dates);
  assert.equal(o.status, "available", o.warning);
  assert.equal(o.ticketsUrl, VAINSTREAM_STOCK);
  assert.equal(ticketSupplementUrl(source), VAINSTREAM_STOCK);
  for (const override of [
    { url: "https://vainstream.com/" },
    { url: "https://foreign.test/artists/" },
    { editionYear: 2028 },
    { fetchUrl: source.url },
    { followLinkPattern: "^/tickets/$" },
    { strategies: ["manual_review"] },
  ])
    assert.equal(ticketSupplementUrl({ ...source, ...override }), undefined);
  assert.equal(
    observeTicketSupplement(fixture, source, VAINSTREAM_STOCK, {
      ...dates,
      startDate: "2026-06-25",
    }).status,
    undefined,
  );
  assert.equal(observeTicketSupplement(fixture, source, VAINSTREAM_STOCK).status, undefined);
  assert.ok(!fixture.includes("__csrf_token"));
});
for (const [name, mutate] of [
  ["archived product title", ($) => $("title").text($("title").text().replace("2027", "2026"))],
  ["VIP instead of regular", ($) => $("h1.product--title").text("VIP Upgrade")],
  ["wrong product binding", ($) => $("[itemprop=productID]").attr("content", "other-product")],
  ["wrong SKU", ($) => $("[itemprop=sku]").text("other-sku")],
  ["wrong form product", ($) => $("input[name=sAdd]").attr("value", "other-sku")],
  ["duplicate offer", ($) => $(".buybox--inner").after($(".buybox--inner").clone())],
  [
    "sold out ordinary pass",
    ($) => $("[itemprop=availability]").attr("href", "https://schema.org/SoldOut"),
  ],
  [
    "unknown availability",
    ($) => $("[itemprop=availability]").attr("href", "https://schema.org/PreOrder"),
  ],
  ["missing stock schema", ($) => $("[itemprop=availability]").remove()],
  ["price but no buy control", ($) => $("button.buybox--button").remove()],
  ["disabled buy control", ($) => $("button.buybox--button").attr("disabled", "")],
  ["disabled quantity", ($) => $("select[name=sQuantity]").attr("disabled", "")],
  ["disabled minimum quantity", ($) => $('option[value="1"]').attr("disabled", "")],
  ["hidden offer", ($) => $(".buybox--inner").attr("hidden", "")],
  ["hidden ancestor", ($) => $(".product--details").attr("style", "display:none")],
  ["hidden framework ancestor", ($) => $(".product--details").addClass("is--hidden")],
  [
    "foreign purchase form",
    ($) => $("form.buybox--form").attr("action", "https://foreign.test/add"),
  ],
  ["changed currency", ($) => $("[itemprop=priceCurrency]").attr("content", "USD")],
  ["invalid price", ($) => $("[itemprop=price]").attr("content", "185,00?")],
  ["conflicting unavailable prose", ($) => $(".buybox--inner").append("<span>Ausverkauft</span>")],
])
  test(`Vainstream: ${name} requires review, never invents a global sellout`, () => {
    const $ = load(fixture);
    mutate($);
    const o = observeTicketSupplement($.html(), source, VAINSTREAM_STOCK, dates);
    assert.equal(o.status, undefined);
    assert.ok(o.warning);
  });
async function pipeline(options = {}) {
  const seen = [];
  const r = await fetchSource(
    { ...source, headers: { authorization: "synthetic-only" } },
    {
      maxAttempts: 1,
      fetchImpl: async (target, init) => {
        seen.push(String(target));
        assert.ok([source.url, VAINSTREAM_STOCK].includes(String(target)));
        assert.ok(init.method === undefined || init.method === "GET");
        assert.ok(!String(target).includes("/checkout/"));
        if (target === VAINSTREAM_STOCK) assert.equal(init.headers.authorization, undefined);
        const response = new Response(target === source.url ? home : fixture, {
          status: target === VAINSTREAM_STOCK ? (options.status ?? 200) : 200,
          headers: {
            "content-type":
              target === VAINSTREAM_STOCK ? (options.type ?? "text/html") : "text/html",
          },
        });
        Object.defineProperty(response, "url", {
          value: target === VAINSTREAM_STOCK ? (options.url ?? VAINSTREAM_STOCK) : source.url,
        });
        return response;
      },
    },
  );
  return { seen, result: r };
}
test("Vainstream GET supplies separate durable ticket proof and preserves artists", async () => {
  const { seen, result } = await pipeline();
  assert.deepEqual(seen, [source.url, VAINSTREAM_STOCK]);
  assert.equal(result.attempts, 2);
  const c = extractFestivalCandidate(await result.response.text(), source, "2026-11-22T13:10:00Z");
  assert.equal(c.ticketStatus, "available");
  assert.equal(c.ticketsUrl, VAINSTREAM_STOCK);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(c.lineup, extractFestivalCandidate(home, source, "2026-11-22T13:10:00Z").lineup);
  assert.ok(c.lineup.length > 0);
  assert.ok(
    c.evidence
      .filter((e) => ["ticketStatus", "ticketsUrl"].includes(e.field))
      .every((e) => e.sourceUrl === VAINSTREAM_STOCK),
  );
});
test("Vainstream: access/schema/redirect failures are errors, not empty stock success", async () => {
  for (const status of [403, 429, 503])
    assert.equal((await pipeline({ status })).result.response.status, status);
  await assert.rejects(pipeline({ url: "https://foreign.test/product" }), /changed identity/);
  await assert.rejects(pipeline({ type: "application/json" }), /non-HTML/);
  assert.equal(
    observeTicketSupplement(
      "<html><title>Access denied</title></html>",
      source,
      VAINSTREAM_STOCK,
      dates,
    ).status,
    undefined,
  );
});

test("Vainstream derives product ID and SKU from matching stock markup", () => {
  const $ = load(fixture);
  $("[itemprop=productID]").attr("content", "29195");
  $("[itemprop=sku]").text("VS-TI-0074");
  $("input[name=sAdd]").attr("value", "VS-TI-0074");
  const observe = () => observeTicketSupplement($.html(), source, VAINSTREAM_STOCK, dates);
  assert.equal(observe().status, "available");
  assert.match(observe().excerpt, /29195 \/ VS-TI-0074/);
  $("input[name=sAdd]").attr("value", "VS-TI-0073");
  assert.equal(observe().status, undefined);
});
