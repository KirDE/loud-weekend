import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetTicketReference,
  budgetTotal,
  initialBudget,
  parseBudgetCost,
  tripBudgetsSchema,
} from "../lib/trip-budget.ts";

test("budgets use integer cents and separate group, nightly and daily amounts", () => {
  assert.equal(budgetTotal(initialBudget), undefined);
  assert.equal(
    budgetTotal({
      ...initialBudget,
      ticket: 25000,
      travel: 10000,
      lodging: 12000,
      days: 4,
      food: 3500,
    }),
    61000,
  );
  assert.equal(
    budgetTotal({
      ...initialBudget,
      people: 2,
      nights: 2,
      days: 2,
      ticket: 101,
      travel: 100,
      lodging: 13,
      camping: 17,
      food: 19,
    }),
    438,
  );
  assert.equal(budgetTotal({ ...initialBudget, ticket: 0 }), 0);
});

test("costs accept dot or decimal comma without rounding or grouping ambiguities", () => {
  for (const [input, expected] of [
    ["0", 0],
    ["0,08", 8],
    [" 4.9 ", 490],
    ["100000.00", 10_000_000],
  ]) {
    assert.equal(parseBudgetCost(input), expected);
  }
  for (const input of ["", "-1", "1e2", "4.001", "100000.01", "1,000.00", "Infinity"]) {
    assert.equal(parseBudgetCost(input), undefined, input);
  }
});

test("sync accepts only bounded, edition-scoped private estimates", () => {
  assert.ok(tripBudgetsSchema.safeParse({ "festival:2027": initialBudget }).success);
  for (const [key, budget] of [
    ["festival", initialBudget],
    ["festival:2027", { ...initialBudget, owner: "private" }],
    ["festival:2027", { ...initialBudget, currency: "ZZZ" }],
    ["festival:2027", { ...initialBudget, people: 0 }],
  ]) {
    assert.equal(tripBudgetsSchema.safeParse({ [key]: budget }).success, false);
  }
});

test("budget references require a single priced ordinary full pass for the selected edition", () => {
  const offer = {
    key: "test-pass",
    kind: "full_pass",
    status: "not_on_sale",
    price: { amountMinor: 14599, currency: "EUR", fees: "unknown" },
    saleDateText: null,
  };
  const published = {
    editionYear: 2027,
    sourceUrl: "https://organiser.example.test/tickets",
    observedAt: "2026-11-23T12:00:00.000Z",
    offers: [offer, { ...offer, key: "day-test", kind: "day_pass" }],
  };
  const festival = { editionYear: 2027, ticketStatus: "unknown", ticketOffers: published };
  assert.deepEqual(budgetTicketReference(festival), {
    price: offer.price,
    sourceUrl: published.sourceUrl,
    observedAt: published.observedAt,
  });
  for (const f of [
    undefined,
    { ...festival, editionYear: 2028 },
    { ...festival, ticketOffers: undefined },
    { ...festival, editionLifecycle: { lifecycle: "hiatus" } },
    ...["sold_out", "sales_ended", "free", "unavailable"].map((ticketStatus) => ({
      ...festival,
      ticketStatus,
    })),
    ...[
      [published.offers[1]],
      [offer, { ...offer, key: "second-pass" }],
      [{ ...offer, price: null }],
      [{ ...offer, status: "sold_out" }],
      [{ ...offer, price: { ...offer.price, amountMinor: -1 } }],
    ].map((offers) => ({ ...festival, ticketOffers: { ...published, offers } })),
  ])
    assert.equal(budgetTicketReference(f), undefined);
});
