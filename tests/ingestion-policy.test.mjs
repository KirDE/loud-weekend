import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const current = {
  slug: "example",
  name: "Example",
  country: "Example",
  countryCode: "EX",
  officialUrl: "https://example.test/",
  headliners: [],
  lineup: [],
  genres: [],
  status: "tba",
  ticketStatus: "unknown",
  updatedAt: "2026-09-22T00:00:00Z",
  editionYear: 2027,
};

const candidate = {
  schemaVersion: 1,
  festivalSlug: "example",
  sourceUrl: "https://example.test/news/2027-announcement",
  fetchedAt: "2026-09-22T13:55:00Z",
  startDate: "2027-06-23",
  endDate: "2027-06-26",
  lineup: ["Example Band"],
  evidence: [],
  warnings: [],
  observedEditionYears: [2027],
};

test("edition-matched first dates and lineup can publish without a pre-existing date", () => {
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reviewReasons, []);
  assert.deepEqual(result.changes.map(({ field, reviewRequired }) => [field, reviewRequired]), [
    ["startDate", false],
    ["endDate", false],
    ["lineup", false],
  ]);
});

test("changing established dates still requires review", () => {
  const result = evaluateCandidate({ ...current, startDate: "2027-06-22", endDate: "2027-06-25" }, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes("date_changed requires review"));
});

test("a lineup for another edition still fails closed", () => {
  const result = evaluateCandidate(current, { ...candidate, observedEditionYears: [2028] });
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes("Candidate edition 2028 does not match catalogue edition 2027"));
});

test("date additions cannot publish with impossible, reversed or out-of-edition dates", () => {
  for (const [startDate, endDate, reason] of [
    ["2027-02-29", undefined, /valid calendar dates/],
    ["2027-06-27", "2027-06-26", /end date cannot precede/],
    ["2028-06-23", undefined, /match the edition year/],
  ]) {
    const result = evaluateCandidate(current, { ...candidate, startDate, endDate });
    assert.equal(result.publishable, false);
    assert.match(result.reviewReasons.join("; "), reason);
  }
  const rollover = evaluateCandidate(current, { ...candidate, startDate: "2027-12-30", endDate: "2028-01-02" });
  assert.equal(rollover.publishable, true);
  const result = evaluateCandidate({ ...current, endDate: "2027-06-22" }, { ...candidate, endDate: undefined });
  assert.equal(result.publishable, false);
  assert.match(result.reviewReasons.join("; "), /end date cannot precede/);
});
