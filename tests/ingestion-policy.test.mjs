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
  assert.deepEqual(
    result.changes.map(({ field, reviewRequired }) => [field, reviewRequired]),
    [
      ["startDate", false],
      ["endDate", false],
      ["lineup", false],
    ],
  );
});

test("changing established dates still requires review", () => {
  const result = evaluateCandidate(
    { ...current, startDate: "2027-06-22", endDate: "2027-06-25" },
    candidate,
  );
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes("date_changed requires review"));
});

test("a lineup for another edition still fails closed", () => {
  const result = evaluateCandidate(current, { ...candidate, observedEditionYears: [2028] });
  assert.equal(result.publishable, false);
  assert.ok(
    result.reviewReasons.includes("Candidate edition 2028 does not match catalogue edition 2027"),
  );
});

test("headliner-only announcements still need matching edition evidence", () => {
  const headlinersOnly = { ...candidate, lineup: undefined, headliners: ["Example Band"] };
  assert.equal(evaluateCandidate(current, headlinersOnly).publishable, true);
  const unbound = evaluateCandidate(current, { ...headlinersOnly, observedEditionYears: [] });
  assert.equal(unbound.publishable, false);
  assert.match(unbound.reviewReasons.join("; "), /edition could not be verified/);
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
  const rollover = evaluateCandidate(current, {
    ...candidate,
    startDate: "2027-12-30",
    endDate: "2028-01-02",
  });
  assert.equal(rollover.publishable, true);
  const result = evaluateCandidate(
    { ...current, endDate: "2027-06-22" },
    { ...candidate, endDate: undefined },
  );
  assert.equal(result.publishable, false);
  assert.match(result.reviewReasons.join("; "), /end date cannot precede/);
});

test("a new billing claim for an already billed artist requires review", () => {
  const artist = {
    id: "fixture-artist",
    slug: "example-band",
    name: "Example Band",
    aliases: ["Earlier Name"],
  };
  for (const field of ["headliners", "lineup"]) {
    const opposite = field === "headliners" ? "lineup" : "headliners";
    const observation = {
      ...candidate,
      lineup: undefined,
      [field]: ["Earlier Name"],
      artistListMode: "additive",
    };
    const alreadyBilled = { ...current, [opposite]: [artist.name] };
    const result = evaluateCandidate(alreadyBilled, observation, [artist]);
    assert.equal(result.publishable, false);
    assert.deepEqual(result.reviewReasons, ["Billing changes require reviewed reclassification"]);
    assert.equal(
      result.changes.some((change) => change.field === field),
      true,
    );
    assert.deepEqual(result.candidate[field], ["Earlier Name"]);

    const unrelated = { ...current, [opposite]: ["Another Band"] };
    assert.equal(evaluateCandidate(unrelated, observation, [artist]).publishable, true);
  }
});

test("new artists cannot be added to both billing groups in one automatic change", () => {
  const result = evaluateCandidate(current, {
    ...candidate,
    headliners: ["example band"],
  });
  assert.equal(result.publishable, false);
  assert.deepEqual(result.reviewReasons, ["Billing changes require reviewed reclassification"]);
});

test("repeated headliners in an unranked announcement do not claim a new billing group", () => {
  const result = evaluateCandidate(
    { ...current, headliners: ["Example Band"] },
    { ...candidate, lineupScope: "announcement", lineup: ["Example Band", "Another Band"] },
  );
  assert.equal(result.publishable, true);
  assert.deepEqual(
    result.changes.filter(({ field }) => field === "lineup").map(({ after }) => after),
    ["Another Band"],
  );
});
