import { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import {
  SUMMER_EVENT,
  SUMMER_EVENT_API,
  SUMMER_TOKEN,
  SUMMER_STOCK,
  SUMMER_PURCHASE,
  SUMMER_SCOPE,
  SUMMER_LIMIT_REQUEST,
  fetchSummerStock,
  observeSummerStock,
} from "../lib/ingestion/summer-ticket-stock.ts";
import { ticketSupplementScope } from "../lib/ingestion/ticket-supplements.ts";
import { summerStockResponse, summerEvent, summerLimits } from "./support/summer-stock-fixture.ts";
before(() => mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-22T14:08:00Z") }));
after(() => mock.timers.reset());

const dates = { startDate: "2027-06-17", endDate: "2027-06-19" },
  source = {
    festivalSlug: "summer-punch",
    url: "https://summerpunchfestival.pl/",
    editionYear: 2027,
    strategies: ["official_markup"],
    enabled: true,
    refreshPolicy: "daily",
  };
const home = readFileSync(
  new URL("./fixtures/official-markup/summer-punch-full.html", import.meta.url),
  "utf8",
);
const produce = () => fetchSummerStock(async (url) => summerStockResponse(url));
test("complete public ordinary rate and sector stock, not generic Event availability", async () => {
  const r = await produce();
  assert.equal(r.attempts, 5);
  const x = observeSummerStock(r.html, dates);
  assert.equal(x.status, "available");
  assert.equal(x.ticketsUrl, SUMMER_PURCHASE);
  assert.deepEqual(ticketSupplementScope(source), SUMMER_SCOPE);
  assert.ok(x.excerpt.includes(SUMMER_EVENT));
});
const invalid = [
  ["foreign distribution", (d) => (d.event.reviewedDistribution = false)],
  ["foreign namespace", (d) => (d.scope.namespace = "foreign")],
  ["foreign product", (d) => (d.scope.productId = "VIP")],
  ["missing scope", (d) => delete d.scope],
  ["missing current dates", () => {}, {}],
  ["wrong primary dates", () => {}, { ...dates, endDate: "2027-06-20" }],
  ["missing event document", (d) => delete d.event],
  ["business error", (d) => (d.event.t = 1)],
  ["inactive sale", (d) => (d.event.acte = false)],
  ["waiting sale", (d) => (d.event.wts = 1)],
  ["basket state", (d) => (d.event.hb = true)],
  ["wrong event", (d) => (d.event.e.id = "foreign")],
  ["old event", (d) => (d.event.e.t = "Summer Punch 2026")],
  ["foreign currency", (d) => (d.event.e.cu = 1)],
  ["access pool", (d) => (d.event.e.hasAccessPools = true)],
  ["VIP replaces ordinary", (d) => (d.event.e.pz[0].tt[0].n = "KARNET 3 DNIOWY VIP")],
  ["rate mismatch", (d) => d.event.e.pz[0].tt[0].id++],
  ["duplicate pool", (d) => d.event.e.pz.push(d.event.e.pz[0])],
  ["hidden rate", (d) => (d.event.e.pz[0].tt[0].v = 128)],
  ["restricted rate", (d) => (d.event.e.pz[0].tt[0].ida = true)],
  ["foreign pool", (d) => d.event.e.pz[0].id++],
  ["zero price", (d) => (d.event.e.pz[0].tt[0].pwsc = 0)],
  ["contradictory price", (d) => (d.event.e.pz[0].tt[0].pwsc += 5)],
  ["zero ordinary stock", (d) => (d.limits.pzttl[0].ttl["140247050"] = 0)],
  ["only VIP stock", (d) => (d.limits.pzttl[0].ttl = { 140247052: 100 })],
  ["malformed limit", (d) => (d.limits.pzttl[0].ttl["140247050"] = "1824")],
  ["limit error", (d) => (d.limits.t = 1)],
  ["sector limited", (d) => (d.sectorLimit.ilrfnns[SUMMER_EVENT] = true)],
  ["zero capacity", (d) => (d.counts.sfc[SUMMER_EVENT] = 0)],
  ["incomplete sector request", (d) => delete d.counts.sfc[SUMMER_EVENT]],
  ["wrong proof source", (d) => (d.stockApi = "https://evil.invalid/")],
];
for (const [name, mutate, p] of invalid)
  test(name + " fails closed", async () => {
    const d = JSON.parse((await produce()).html);
    mutate(d);
    assert.equal(observeSummerStock(JSON.stringify(d), p ?? dates).status, undefined);
  });
test("scoped ordinary stock cannot be rescued by VIP/child limits or sector capacity alone", async () => {
  const d = JSON.parse((await produce()).html);
  d.limits.pzttl[0].ttl = { 140247050: 0, 140247052: 81, 140247053: 47 };
  assert.equal(observeSummerStock(JSON.stringify(d), dates).status, undefined);
});
test("collector uses public CSRF and rate IDs without persisting auth, customer or cart data", async () => {
  const calls = [];
  const fetched = await fetchSource(
    { ...source, headers: { authorization: "synthetic-private", cookie: "synthetic-private" } },
    {
      maxAttempts: 1,
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        if (url === source.url) {
          const r = new Response(home);
          Object.defineProperty(r, "url", { value: source.url });
          return r;
        }
        assert.ok(!String(init.headers?.authorization ?? "").includes("private"));
        assert.ok(!String(init.headers?.cookie ?? "").includes("private"));
        if (url === SUMMER_STOCK) {
          assert.equal(init.method, "POST");
          assert.equal(init.redirect, "error");
          assert.deepEqual(JSON.parse(init.body), SUMMER_LIMIT_REQUEST);
          assert.equal(init.headers["x-xsrf-token"], "synthetic-public-token-only");
          assert.match(init.headers.cookie, /Antiforgery.Test=synthetic-csrf-cookie/);
        }
        if (url === SUMMER_EVENT_API) {
          const d = structuredClone(summerEvent);
          d.customer = "synthetic-do-not-store";
          d.ssdh = "synthetic-do-not-store";
          d.e.organizer = "synthetic-do-not-store";
          return Response.json(d);
        }
        return summerStockResponse(url);
      },
    },
  );
  assert.equal(fetched.attempts, 6);
  assert.equal(calls.length, 6);
  const body = await fetched.response.text();
  assert.ok(!/synthetic-|csrf|x-xsrf|Antiforgery|<input/.test(JSON.parse(body).ticket.html));
  const c = extractFestivalCandidate(body, source, "2026-11-22T14:08:00Z");
  assert.equal(c.ticketStatus, "available");
  assert.deepEqual(c.ticketSupplement.scope, SUMMER_SCOPE);
  assert.deepEqual(c.warnings, []);
});
test("composed acquisition reports every failed request once", async () => {
  const calls = [];
  await assert.rejects(
    fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (url === source.url) {
          const response = new Response(home);
          Object.defineProperty(response, "url", { value: source.url });
          return response;
        }
        assert.equal(url, SUMMER_EVENT_API);
        return new Response(null, { status: 503 });
      },
    }),
    (error) => error.attempts === 2,
  );
  assert.deepEqual(calls, [source.url, SUMMER_EVENT_API]);
});
test("HTTP/schema/redirect/token/oversized/network failures are not retried or healthy stock", async () => {
  for (const mode of ["token", "http", "media", "redirect", "size", "network"]) {
    let posts = 0,
      calls = 0;
    const task = () =>
      fetchSummerStock(async (url) => {
        calls++;
        if (url === SUMMER_TOKEN && mode === "token")
          return new Response("<p>changed</p>", { headers: { "content-type": "text/html" } });
        if (url === SUMMER_STOCK) {
          posts++;
          if (mode === "network") throw new Error("offline");
          if (mode === "http") return new Response("", { status: 403 });
          if (mode === "media")
            return new Response("blocked", { headers: { "content-type": "text/html" } });
          if (mode === "size")
            return new Response("x".repeat(2000001), {
              headers: { "content-type": "application/json" },
            });
          if (mode === "redirect") {
            const r = Response.json(summerLimits);
            Object.defineProperty(r, "url", { value: "https://evil.invalid" });
            return r;
          }
        }
        return summerStockResponse(url);
      });
    await assert.rejects(task, (e) => {
      assert.equal(e.attempts, calls);
      assert.ok(!e.message.includes("synthetic"));
      return true;
    });
    assert.equal(posts, mode === "token" ? 0 : 1);
  }
});

test("changed or closed event identity stops before requesting CSRF or stock", async () => {
  for (const mutate of [
    (d) => (d.e.id = "foreign"),
    (d) => (d.acte = false),
    (d) => (d.dk = "foreign-channel"),
    (d) => delete d.e,
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchSummerStock(async (url) => {
        calls++;
        assert.equal(url, SUMMER_EVENT_API);
        const d = structuredClone(summerEvent);
        mutate(d);
        return Response.json(d);
      }),
    );
    assert.equal(calls, 1);
  }
});

test("Summer Punch takes rescheduled dates from corroborating organizer and vendor data", async () => {
  const stock = JSON.parse((await produce()).html);
  stock.event.e.sd = "2027-06-24T16:00:00";
  stock.event.e.ed = "2027-06-26T23:59:00";
  stock.event.e.sed = "2027-06-26T23:59:00";
  const shifted = { startDate: "2027-06-24", endDate: "2027-06-26" };
  const observe = (primary) => observeSummerStock(JSON.stringify(stock), primary);
  assert.equal(observe(dates).status, undefined);
  assert.match(observe(shifted).excerpt, /2027-06-24–2027-06-26/);
  delete stock.event.e.sed;
  assert.equal(observe(shifted).status, undefined);
});
