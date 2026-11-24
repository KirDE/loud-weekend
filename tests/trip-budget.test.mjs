import assert from "node:assert/strict";
import test from "node:test";
import {
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
