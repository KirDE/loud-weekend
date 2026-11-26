import { mock, after } from "node:test";
mock.method(Date, "now", () => Date.parse("2026-11-22T14:30:00Z"));
after(() => mock.restoreAll());
import { isProvinssiAnnouncement } from "../lib/ingestion/adapters/provinssi.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import {
  fetchProvinssiStock,
  observeProvinssiStock,
  PROVINSSI_SALE_API,
  PROVINSSI_STOCK,
  PROVINSSI_SCOPE,
} from "../lib/ingestion/provinssi-ticket-stock.ts";
import {
  provinssiSale,
  provinssiStore,
  provinssiStockResponse,
} from "./support/provinssi-stock-fixture.ts";
const dates = { startDate: "2027-07-01", endDate: "2027-07-03" },
  get = () => fetchProvinssiStock(async (url) => provinssiStockResponse(url));
test("ordinary published three-day pass has current public scoped stock", async () => {
  const r = await get();
  assert.equal(r.attempts, 2);
  assert.equal(observeProvinssiStock(r.html, dates).status, "available");
  assert.ok(!r.html.includes(provinssiSale.jwt_token));
});
const bad = [
  ["scope", (d) => (d.scope.productId = "VIP")],
  ["namespace", (d) => (d.scope.namespace = "other")],
  ["missing data", (d) => delete d.store],
  ["aggregate soldout", (d) => (d.store.is_sold_out = true)],
  ["ordinary soldout", (d) => (d.store.categories[0].categories[0].items[0].is_sold_out = true)],
  ["membership", (d) => (d.store.products[0].requires_membership = true)],
  ["VIP product", (d) => (d.store.products[0].name.en = "3 DAYS VIP 18+")],
  ["child product", (d) => (d.store.products[0].name.en = "YOUTH")],
  ["group minimum", (d) => (d.store.categories[0].categories[0].items[0].min_quantity = 3)],
  ["zero maximum", (d) => (d.store.products[0].max_per_order = 0)],
  ["foreign currency", (d) => (d.store.products[0].price.currency = "USD")],
  ["zero price", (d) => (d.store.products[0].price.amount = "0.00")],
  [
    "missing fee",
    (d) =>
      delete d.store.categories[0].categories[0].items[0].price_breakdown.unit_price_service_costs,
  ],
  ["duplicate ordinary", (d) => d.store.products.push(d.store.products[0])],
  ["old event", (d) => (d.store.event.event_start = "2026-07-01T12:00:00Z")],
  ["expired product", (d) => (d.store.products[0].sale_end = "2026-01-01T00:00:00Z")],
  ["future product", (d) => (d.store.products[0].sale_start = "2027-01-01T00:00:00Z")],
  ["closed sale", (d) => (d.sale.state = "Closed")],
  ["queue", (d) => (d.sale.queue_enabled = true)],
  [
    "secondary-only",
    (d) => (d.store.categories[0].categories[0].items[0].available_in_secondary_sale = true),
  ],
  ["unknown item stock", (d) => delete d.store.categories[0].categories[0].items[0].is_sold_out],
];
for (const [name, mutate] of bad)
  test(name + " fails closed", async () => {
    const d = JSON.parse((await get()).html);
    mutate(d);
    assert.equal(observeProvinssiStock(JSON.stringify(d), dates).status, undefined);
  });
test("invalid primary dates cannot be overwritten by shop", async () =>
  assert.equal(
    observeProvinssiStock((await get()).html, { ...dates, startDate: "2027-06-24" }).status,
    undefined,
  ));
test("exact public token only reaches fixed GET; no source auth or private extras persisted", async () => {
  const source = {
      festivalSlug: "provinssi",
      url: "https://www.provinssi.fi/en/",
      editionYear: 2027,
      strategies: ["official_markup"],
      enabled: true,
      refreshPolicy: "daily",
    },
    home = readFileSync(
      new URL("./fixtures/official-markup/provinssi-excerpt.html", import.meta.url),
      "utf8",
    );
  const r = await fetchSource(
    { ...source, headers: { authorization: "synthetic-private" } },
    {
      maxAttempts: 1,
      fetchImpl: async (url, init) => {
        if (url === source.url) return new Response(home);
        if (url === PROVINSSI_SALE_API) {
          assert.equal(init.headers.authorization, undefined);
          const d = structuredClone(provinssiSale);
          d.legal_info = "synthetic-do-not-store";
          return Response.json(d);
        }
        assert.equal(url, PROVINSSI_STOCK);
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers.authorization, "Bearer " + provinssiSale.jwt_token);
        return Response.json(provinssiStore);
      },
    },
  );
  assert.equal(r.attempts, 3);
  const body = await r.response.text();
  assert.ok(!body.includes("synthetic"));
  const c = extractFestivalCandidate(body, source, "2026-11-22T14:30:00Z");
  assert.equal(c.ticketStatus, "available");
  assert.equal(isProvinssiAnnouncement(c, 2027), true);
  assert.deepEqual(c.ticketSupplement.scope, PROVINSSI_SCOPE);
  assert.deepEqual(c.warnings, []);
});
test("changed sale/queue stops before stock, failures are never healthy empty", async () => {
  for (const mode of ["sale", "queue", "http", "redirect", "size"]) {
    let calls = 0;
    await assert.rejects(
      fetchProvinssiStock(async (url) => {
        calls++;
        if (url === PROVINSSI_SALE_API) {
          const d = structuredClone(provinssiSale);
          if (mode === "sale") d.uid = "other";
          if (mode === "queue") d.queue_enabled = true;
          return Response.json(d);
        }
        if (mode === "http") return new Response("", { status: 403 });
        if (mode === "size")
          return new Response("x".repeat(2000001), {
            headers: { "content-type": "application/json" },
          });
        const r = Response.json(provinssiStore);
        if (mode === "redirect") Object.defineProperty(r, "url", { value: "https://evil.invalid" });
        return r;
      }),
      (e) => e.attempts === calls,
    );
    assert.equal(calls, ["sale", "queue"].includes(mode) ? 1 : 2);
  }
});

test("Provinssi compares provider timestamps to locally dated organizer evidence", async () => {
  const stock = JSON.parse((await get()).html);
  stock.store.event.event_start = "2027-07-07T21:00:00Z";
  stock.store.event.event_end = "2027-07-10T20:59:00Z";
  const shifted = { startDate: "2027-07-08", endDate: "2027-07-10" };
  const observe = (primary) => observeProvinssiStock(JSON.stringify(stock), primary);
  assert.equal(observe(dates).status, undefined);
  assert.match(observe(shifted).excerpt, /2027-07-08–2027-07-10/);
  delete stock.store.event.event_end;
  assert.equal(observe(shifted).status, undefined);
});

const netStock = () =>
  JSON.parse(
    readFileSync(
      new URL("./fixtures/ticket-status/provinssi-net-price-20261126.json", import.meta.url),
      "utf8",
    ),
  );
test("real November ordinary stock separates net unit price from service-inclusive price", () => {
  const d = netStock();
  const observed = observeProvinssiStock(JSON.stringify(d), dates);
  assert.equal(observed.status, "available");
  assert.match(observed.excerpt, /EUR 219.00/);
});
test("later ordinary prices accept both net and gross item conventions with matching fees", () => {
  for (const unit of ["224.00", "230.00"]) {
    const d = netStock(),
      i = d.store.categories[0].categories[0].items[0];
    d.store.products[0].price.amount = "224.00";
    i.unit_price.amount = i.total.amount = unit;
    i.price_breakdown.unit_price_excluding_service_costs.amount = "224.00";
    i.price_breakdown.unit_price_service_costs.amount = "6.00";
    i.price_breakdown.unit_price_including_service_costs.amount = "230.00";
    const observed = observeProvinssiStock(JSON.stringify(d), dates);
    assert.equal(observed.status, "available");
    assert.match(observed.excerpt, /EUR 230.00/);
  }
});
test("net-price evidence still refuses conflicting totals, breakdowns, currencies and soldout", () => {
  for (const mode of ["total", "unit", "gross", "net", "fee", "currency", "soldout"]) {
    const d = netStock(),
      i = d.store.categories[0].categories[0].items[0];
    if (mode === "total") i.total.amount = "219.00";
    if (mode === "unit") i.unit_price.amount = i.total.amount = "216.00";
    if (mode === "gross") i.price_breakdown.unit_price_including_service_costs.amount = "220.00";
    if (mode === "net") i.price_breakdown.unit_price_excluding_service_costs.amount = "213.00";
    if (mode === "fee") i.price_breakdown.unit_price_service_costs.amount = "6.00";
    if (mode === "currency") i.price_breakdown.unit_price_including_service_costs.currency = "USD";
    if (mode === "soldout") i.is_sold_out = true;
    assert.equal(observeProvinssiStock(JSON.stringify(d), dates).status, undefined, mode);
  }
});
