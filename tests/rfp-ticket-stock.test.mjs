import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import {
  RFP_STOCK,
  RFP_PURCHASE,
  observeRfpStock,
  reduceRfpStockDocument,
} from "../lib/ingestion/rfp-ticket-stock.ts";
import { ticketSupplementUrl } from "../lib/ingestion/ticket-supplements.ts";
const raw = readFileSync(
    new URL("./fixtures/ticket-status/rfp-public-sales.json", import.meta.url),
    "utf8",
  ),
  primary = { observedEditionYears: [2027] },
  source = {
    festivalSlug: "rock-for-people",
    url: "https://rockforpeople.cz/",
    editionYear: 2027,
    strategies: ["official_markup"],
    enabled: true,
    refreshPolicy: "daily",
  };
const parse = (data = JSON.parse(raw), p = primary) =>
  observeRfpStock(JSON.stringify(data), 2027, p);
test("actual ordinary public GoOut rate not VIP/child stock; order cap is not low stock", () => {
  assert.equal(parse().status, "available");
  assert.equal(parse().ticketsUrl, RFP_PURCHASE);
  assert.equal(ticketSupplementUrl(source), RFP_STOCK);
  const d = JSON.parse(raw);
  d.sales["579901"].deals["3633368"].counts.ticketsAvailable = 1;
  d.sales["579901"].deals["3633368"].isLastTickets = true;
  assert.equal(parse(d).status, "available");
});
const bad = [
  ["stale primary", () => {}, { observedEditionYears: [2026] }],
  ["missing primary edition", () => {}, {}],
  ["mismatching primary date", () => {}, { ...primary, startDate: "2027-06-09" }],
  ["foreign sale", (s) => s.id++],
  ["inactive sale", (s) => (s.state = "INACTIVE")],
  ["voucher", (s) => (s.voucher = true)],
  ["promo-protected", (s) => (s.promoCodeProtected = true)],
  ["pass-protected", (s) => (s.passCodeProtected = true)],
  ["foreign currency", (s) => (s.currency = "EUR")],
  ["wrong precision", (s) => (s.precisionCents = 1)],
  ["archived event", (s) => (s.eventName = "Rock for People 2026")],
  ["foreign URL", (s) => (s.url = "https://evil.invalid")],
  ["cancelled", (s) => (s.schedule.cancelled = true)],
  ["foreign schedule", (s) => s.schedule.id++],
  ["wrong event dates", (s) => (s.schedule.startISO8601 = "2026-06-02T12:00:01+02:00")],
  ["restricted child rate", (s) => (s.deals["3633368"].name = "4 dny - Junior 10-17 let")],
  ["VIP rate", (s) => (s.deals["3633368"].name = "4 dny – VIP")],
  ["foreign rate", (s) => s.deals["3633368"].id++],
  ["disabled rate", (s) => (s.deals["3633368"].active = false)],
  ["hidden rate", (s) => (s.deals["3633368"].hidden = true)],
  ["print only", (s) => (s.deals["3633368"].onlyPrint = true)],
  ["preowned required", (s) => (s.deals["3633368"].preOwnedTicketsRequired = true)],
  ["zero price", (s) => (s.deals["3633368"].priceCents = 0)],
  ["minimum 3 group", (s) => (s.deals["3633368"].counts.ticketsMinimum = 3)],
  ["missing stock", (s) => delete s.deals["3633368"].counts.ticketsAvailable],
  ["zero ordinary stock", (s) => (s.deals["3633368"].counts.ticketsAvailable = 0)],
  ["fractional stock", (s) => (s.deals["3633368"].counts.ticketsAvailable = 0.5)],
];
for (const [name, mutate, p] of bad)
  test(name + " fails closed", () => {
    const d = JSON.parse(raw);
    mutate(d.sales["579901"]);
    assert.equal(parse(d, p ?? primary).status, undefined);
  });
test("unavailable ordinary cannot be rescued by an available restricted sibling", () => {
  const d = JSON.parse(raw),
    s = d.sales["579901"];
  s.deals["999"] = { ...s.deals["3633368"], id: 999, name: "4 dny – VIP" };
  s.deals["3633368"].counts.ticketsAvailable = 0;
  assert.equal(parse(d).status, undefined);
});
test("only current production response is stock; public reduction excludes contact/legal/payment/session data", () => {
  const d = JSON.parse(raw);
  d.sales["579901"].contact = { email: "synthetic-do-not-store" };
  d.termsAndConditions = "synthetic-do-not-store";
  d.session = "synthetic-do-not-store";
  const reduced = reduceRfpStockDocument(JSON.stringify(d));
  assert.ok(!reduced.includes("synthetic-do-not-store"));
  assert.equal(observeRfpStock(reduced, 2027, primary).status, "available");
  for (const change of [(d) => (d.status = 500), (d) => (d.production = false)]) {
    const d = JSON.parse(raw);
    change(d);
    assert.equal(parse(d).status, undefined);
  }
});
test("fetch strips inherited auth and persists stock without changing artist provenance", async () => {
  const home = readFileSync(
    new URL("./fixtures/official-markup/rfp-current-20261103.html", import.meta.url),
    "utf8",
  );
  const fetched = await fetchSource(
    { ...source, headers: { authorization: "synthetic-only" } },
    {
      maxAttempts: 1,
      fetchImpl: async (url, init) => {
        if (url === source.url) return new Response(home);
        assert.equal(url, RFP_STOCK);
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(init.headers.authorization, undefined);
        const d = JSON.parse(raw);
        d.sales["579901"].contact = "synthetic-do-not-store";
        return Response.json(d);
      },
    },
  );
  assert.equal(fetched.attempts, 2);
  const body = await fetched.response.text();
  assert.ok(!body.includes("synthetic-do-not-store"));
  const c = extractFestivalCandidate(body, source, "2026-11-22T14:10:00Z");
  assert.equal(c.ticketStatus, "available");
  assert.equal(c.artistListMode, "additive");
  assert.equal(c.lineupScope, "announcement");
  assert.deepEqual(c.warnings, []);
  assert.equal(c.startDate, undefined);
});

test("RFP derives the current four-day schedule and open rate from source fields", () => {
  const data = JSON.parse(raw);
  const sale = data.sales["579901"];
  sale.schedule.startISO8601 = "2027-06-03T12:00:01+02:00";
  sale.schedule.endISO8601 = "2027-06-06T23:59:00+02:00";
  sale.deals["3633368"].start = "2026-08-06T20:49:00+02:00";
  const result = parse(data, { ...primary, startDate: "2027-06-03", endDate: "2027-06-06" });
  assert.equal(result.status, "available");
  assert.match(result.excerpt, /2027-06-03–2027-06-06/);
  assert.doesNotMatch(result.excerpt, /2027-06-02/);
  delete sale.schedule.endISO8601;
  assert.equal(parse(data).status, undefined);
});

test("RFP rejects invalid, reversed and not-yet-open vendor windows", () => {
  for (const mutate of [
    (sale) => {
      sale.schedule.startISO8601 = "2027-06-06T12:00:00+02:00";
    },
    (sale) => {
      sale.schedule.endISO8601 = "2027-06-05T23:59:00+99:00";
    },
    (sale) => {
      sale.startISO8601 = "not a timestamp";
    },
    (sale) => {
      sale.deals["3633368"].start = "2027-05-01T00:00:00+02:00";
    },
  ]) {
    const data = JSON.parse(raw);
    mutate(data.sales["579901"]);
    assert.equal(parse(data).status, undefined);
  }
});
