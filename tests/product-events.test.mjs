import assert from "node:assert/strict";
import test from "node:test";
import { createProductEventLimiter, parseProductEvent } from "../lib/product-event-ingestion.ts";
import { pruneAnalytics } from "../lib/analytics-retention.ts";

const request = (raw) =>
  new Request("http://127.0.0.1/api/analytics/page-view/", { method: "POST", body: raw });

test("aggregate parser accepts only an event name and supported locale", async () => {
  const payload = { event: "SEARCH_SUBMIT", locale: "de" };
  assert.deepEqual(await parseProductEvent(request(JSON.stringify(payload))), payload);
  for (const invalid of [
    { ...payload, search: "fictional artist" },
    { ...payload, id: "fixture" },
    { ...payload, url: "/planner/" },
    { ...payload, locale: "xx" },
    { ...payload, event: "CUSTOM" },
  ]) {
    assert.equal(await parseProductEvent(request(JSON.stringify(invalid))), undefined);
  }
  assert.equal(
    await parseProductEvent(request(JSON.stringify(payload) + " ".repeat(129))),
    undefined,
  );
  assert.equal(await parseProductEvent(request("{")), undefined);
  assert.equal(await parseProductEvent(request(Uint8Array.of(255))), undefined);
});

test("the aggregate limit uses a process-wide time window and no request identifiers", () => {
  const allow = createProductEventLimiter();
  for (let i = 0; i < 240; i++) assert.equal(allow(70_000), true);
  assert.equal(allow(119_999), false);
  assert.equal(allow(120_000), true);
});

test("the established retention cutoff removes both aggregate types", async () => {
  const dates = [];
  const store = (count) => ({
    deleteMany: async ({ where }) => {
      dates.push(where.day.lt.toISOString());
      return { count };
    },
  });
  const result = await pruneAnalytics(
    {
      analyticsDaily: store(2),
      productEventDaily: store(3),
    },
    "7",
    new Date("2026-11-23T15:00:00.000Z"),
  );
  assert.deepEqual(dates, ["2026-11-16T00:00:00.000Z", "2026-11-16T00:00:00.000Z"]);
  assert.equal(result.deletedAggregateRows, 2);
  assert.equal(result.deletedProductEventRows, 3);
});
