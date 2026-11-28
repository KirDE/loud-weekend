import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDataQuality } from "../lib/catalog/data-quality.ts";

const now = Date.parse("2026-11-23T02:00Z");
const checkedAt = "2026-11-21T09:00:00.000Z";
const performance = {
  date: "2027-06-18",
  start: "20:45",
  stage: "Main Stage",
  artist: "Verified artist",
  timeZone: "Europe/Berlin",
  status: "scheduled",
  sourceUrl: "https://festival.example.test/private-schedule-fixture",
  observedAt: checkedAt,
};
const festival = {
  officialUrl: "https://festival.example.test/",
  startDate: "2027-06-17",
  endDate: "2027-06-19",
  status: "confirmed",
  headliners: ["Verified artist"],
  lineup: [],
  ticketStatus: "sold_out",
  timetable: [performance],
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
    hiatus: 0,
    dates: 2,
    lineup: 2,
    lineupDayCoverage: 0,
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

test("stage schedule coverage excludes malformed, out-of-edition and future observations", () => {
  const tally = summarizeDataQuality(
    {
      festivals: [
        { ...festival, timetable: [{ ...performance, start: "25:00" }] },
        { ...festival, timetable: [{ ...performance, date: "2027-06-20" }] },
        { ...festival, timetable: [{ ...performance, observedAt: "2029-01-01T00:00:00.000Z" }] },
        { ...festival, timetable: [{ ...performance, timeZone: "Not/AZone" }, performance] },
      ],
      editions: [],
    },
    now,
  );
  assert.equal(tally.timetable, 1);
  assert.doesNotMatch(JSON.stringify(tally), /private-schedule-fixture/);
});

test("undated editions do not count performances from another season", () => {
  const edition = { ...festival, startDate: undefined, endDate: undefined, editionYear: 2027 };
  const count = (festival) =>
    summarizeDataQuality({ festivals: [festival], editions: [] }, now).timetable;
  assert.equal(count({ ...edition, timetable: [{ ...performance, date: "2026-06-18" }] }), 0);
  assert.equal(count(edition), 1);
  assert.equal(
    count({
      ...edition,
      startDate: "2027-12-31",
      endDate: "2028-01-02",
      timetable: [{ ...performance, date: "2028-01-01" }],
    }),
    1,
  );
});

test("schedule coverage requires the same official source host as reviewed import", () => {
  const tally = summarizeDataQuality(
    {
      festivals: [
        {
          ...festival,
          timetable: [
            { ...performance, sourceUrl: "https://festival.example.test.unofficial.test/schedule" },
          ],
        },
        { ...festival, officialUrl: "invalid legacy URL" },
        festival,
      ],
      editions: [],
    },
    now,
  );
  assert.equal(tally.timetable, 1);
});

test("published hiatus excludes retained facts from coverage but not source health", () => {
  const paused = {
    ...festival,
    slug: "synthetic-paused",
    editionYear: 2027,
    editionLifecycle: {
      festivalSlug: "synthetic-paused",
      editionYear: 2027,
      lifecycle: "hiatus",
      announcedReturnYear: null,
      alternativeEvent: null,
      sourceUrl: festival.officialUrl,
      observedAt: checkedAt,
      approvedAt: checkedAt,
    },
  };
  paused.lineupDays = [
    {
      artist: "Verified artist",
      artistSlug: "verified-artist",
      dates: ["2027-06-17"],
      cancelled: false,
      sourceUrl: festival.officialUrl,
      observedAt: checkedAt,
    },
  ];
  const mixed = summarizeDataQuality({ festivals: [festival, paused], editions: [] }, now);
  assert.equal(mixed.total, 2);
  assert.equal(mixed.checked, 2);
  assert.equal(mixed.dates, 1);
  assert.equal(mixed.lineup, 1);
  assert.equal(mixed.tickets, 1);
  assert.equal(mixed.timetable, 1);
  assert.equal(mixed.hiatus, 1);

  const allPaused = summarizeDataQuality({ festivals: [paused], editions: [] }, now);
  assert.equal(allPaused.hiatus, allPaused.total);
  assert.equal(allPaused.dates, 0);
  assert.equal(allPaused.tickets, 0);
  assert.equal(allPaused.timetable, 0);
  assert.equal(allPaused.lineupDayCoverage, 0);
});

test("published lineup day coverage counts editions, not acts or stage times", () => {
  const appearance = {
    artist: "Verified artist",
    artistSlug: "verified-artist",
    dates: ["2027-06-17", "2027-06-18"],
    cancelled: false,
    sourceUrl: "https://festival.example.test/private-day-fixture",
    observedAt: checkedAt,
  };
  const edition = { ...festival, timetable: undefined };
  const count = (record) =>
    summarizeDataQuality({ festivals: [record], editions: [] }, now).lineupDayCoverage;
  const valid = {
    ...edition,
    lineupDays: [appearance, { ...appearance, artistSlug: "second-act" }],
  };
  const tally = summarizeDataQuality({ festivals: [valid], editions: [] }, now);
  assert.equal(tally.lineupDayCoverage, 1);
  assert.equal(tally.timetable, 0);
  assert.doesNotMatch(JSON.stringify(tally), /private-day-fixture|verified-artist/);
  assert.equal(count({ ...valid, endDate: undefined }), 0);
  for (const invalid of [
    { cancelled: true },
    { dates: [] },
    { dates: ["2027-06-20"] },
    { dates: ["2027-06-17T12:00:00Z"] },
    { sourceUrl: undefined },
    { sourceUrl: "https://other.example.test/lineup" },
    { sourceUrl: appearance.sourceUrl + "?preview=1" },
    { observedAt: "2029-01-01T00:00:00.000Z" },
  ]) {
    assert.equal(count({ ...edition, lineupDays: [{ ...appearance, ...invalid }] }), 0);
  }
});
