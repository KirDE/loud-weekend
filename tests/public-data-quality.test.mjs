import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDataQuality } from "../lib/catalog/data-quality.ts";

const now = Date.parse("2026-11-23T02:00Z");
const checkedAt = "2026-11-21T09:00:00.000Z";
const festival = {
  startDate: "2027-06-17",
  endDate: "2027-06-19",
  status: "confirmed",
  headliners: ["Verified artist"],
  lineup: [],
  ticketStatus: "sold_out",
  timetable: [{ status: "scheduled", sourceUrl: "private-schedule-fixture" }],
  freshness: { sourceCheckStale: false, lastSuccessfulSourceCheckAt: checkedAt },
};
const current = {
  recordState: "current",
  provenance: [
    { field: "dates", checkedAt, note: "private-editor-fixture" },
    { field: "dates", checkedAt, note: "redundant-proof-fixture" },
    { field: "lineup", checkedAt, note: "private-evidence-fixture" },
  ],
};

test("data quality aggregates only current records and excludes stale/invalid evidence from health", () => {
  const tally = summarizeDataQuality(
    {
      festivals: [
        festival,
        {
          ...festival,
          timetable: [{ status: "cancelled" }],
          freshness: {
            sourceCheckStale: true,
            lastSuccessfulSourceCheckAt: "2026-11-22T09:00:00.000Z",
          },
        },
        {
          ticketStatus: "unknown",
          headliners: [],
          lineup: [],
          freshness: {
            sourceCheckStale: false,
            lastSuccessfulSourceCheckAt: "2029-01-01T00:00:00.000Z",
          },
        },
        { ticketStatus: "unknown", headliners: [], lineup: [], sourceDeprecated: true },
      ],
      editions: [
        current,
        { ...current, recordState: "archived" },
        { ...current, provenance: [{ field: "lineup", checkedAt: "2029-01-01T00:00:00.000Z" }] },
      ],
    },
    now,
  );
  assert.deepEqual(tally, {
    total: 4,
    dates: 2,
    lineup: 2,
    tickets: 2,
    timetable: 1,
    dateEvidence: 1,
    lineupEvidence: 1,
    checked: 1,
    stale: 2,
    notChecked: 1,
    lastRecentCheck: checkedAt,
  });
  assert.doesNotMatch(JSON.stringify(tally), /private|redundant/);
});

test("absence of a source check is not success or proof of an outage", () => {
  const empty = summarizeDataQuality({ festivals: [], editions: [] }, now);
  assert.equal(empty.total, 0);
  assert.equal(empty.lastRecentCheck, undefined);
  const unchecked = summarizeDataQuality(
    {
      festivals: [{ ...festival, freshness: { checkedAt, sourceCheckStale: false } }],
      editions: [current],
    },
    now,
  );
  assert.equal(unchecked.notChecked, 1);
  assert.equal(unchecked.checked, 0);
  assert.equal(unchecked.stale, 0);
  assert.equal(unchecked.lastRecentCheck, undefined);
});
