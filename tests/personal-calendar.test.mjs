import assert from "node:assert/strict";
import test from "node:test";
import { personalCalendar } from "../lib/personal-calendar.ts";
import { readEditionAttendance } from "../lib/planner-storage.ts";
import { calendarFile } from "../lib/planning.ts";

const festival = (slug, startDate, endDate) => ({
  slug,
  name: slug,
  startDate,
  endDate,
  editionYear: 2027,
  country: "Testland",
  officialUrl: "https://example.test/",
});

test("shared days conflict once, while day-after adjacency, unscheduled and declined do not", () => {
  const a = festival("a", "2027-06-30", "2027-07-02");
  const b = festival("b", "2027-07-02", "2027-07-02");
  const c = festival("c", "2027-07-03", "2027-07-04");
  const d = festival("d", "2027-07-01", "2027-07-03");
  const unknown = festival("unknown");
  const invalid = festival("invalid", "2027-02-29");
  const attendance = {
    a: "going",
    b: "maybe",
    c: "going",
    d: "not-going",
    unknown: "maybe",
    invalid: "going",
  };
  const result = personalCalendar([c, b, a, unknown, invalid, d], (slug) => attendance[slug]);
  assert.deepEqual(result.dated, [a, b, c]);
  assert.deepEqual(result.undated, [unknown, invalid]);
  assert.deepEqual(result.conflicts, [
    { first: a, second: b, range: { startDate: "2027-07-02", endDate: "2027-07-02" } },
  ]);
  const ics = calendarFile(result.dated);
  assert.match(
    ics,
    /UID:a-2027@festival-radar\r\nDTSTAMP:\d{8}T\d{6}Z\r\nDTSTART;VALUE=DATE:20270630\r\nDTEND;VALUE=DATE:20270703/,
  );
  assert.doesNotMatch(ics, /UID:(d|unknown|invalid)-/);
});

test("reports all pairs when three selected festivals overlap, independent of catalogue order", () => {
  const rows = ["c", "b", "a"].map((slug) => festival(slug, "2027-07-01", "2027-07-02"));
  const attendance = { a: "going", b: "going", c: "maybe" };
  const { conflicts } = personalCalendar(rows, (slug) => attendance[slug]);
  assert.deepEqual(
    conflicts.map(({ first, second }) => [first.slug, second.slug]),
    [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ],
  );
});

test("subscription revisions keep a stable UID and expose their actual modification timestamp", () => {
  const before = {
    ...festival("a", "2027-07-01", "2027-07-02"),
    calendarId: "stable-edition",
    calendarUpdatedAt: "2026-11-26T12:00:00.000Z",
  };
  const after = {
    ...before,
    startDate: "2027-07-02",
    calendarUpdatedAt: "2026-11-27T14:21:00.000Z",
  };
  const poll = new Date("2026-11-28T12:00:00Z");
  assert.equal(calendarFile([before]), calendarFile([before], poll));
  assert.match(calendarFile([before], poll), /UID:stable-edition@festival-radar/);
  assert.match(calendarFile([after], poll), /UID:stable-edition@festival-radar/);
  assert.match(calendarFile([before], poll), /LAST-MODIFIED:20261126T120000Z/);
  const revised = calendarFile([after], poll);
  assert.match(revised, /LAST-MODIFIED:20261127T142100Z/);
  assert.match(revised, /DTSTART;VALUE=DATE:20270702/);
  assert.doesNotMatch(
    calendarFile([{ ...before, calendarUpdatedAt: "invalid" }], poll),
    /LAST-MODIFIED/,
  );
});

test("calendar dates and conflicts use only the attendance for each known edition", () => {
  const legacy = festival("a", "2027-07-01", "2027-07-02");
  const future = { ...festival("a", "2028-07-01", "2028-07-02"), editionYear: 2028 };
  const otherFuture = { ...future, slug: "b" };
  const unknown = { ...future, editionYear: undefined };
  const state = { attendance: { a: "going" }, seasonAttendance: { "2028:b": "maybe" } };
  const rows = [legacy, future, otherFuture, unknown];
  const read = (slug, year) => readEditionAttendance(state, slug, year);
  const before = personalCalendar(rows, read);
  assert.deepEqual(before, { dated: [legacy, otherFuture], undated: [], conflicts: [] });
  assert.doesNotMatch(calendarFile(before.dated), /UID:a-2028@/);

  state.seasonAttendance["2028:a"] = "maybe";
  const after = personalCalendar(rows, read);
  assert.equal(after.conflicts.length, 1);
  assert.deepEqual(after.dated, [legacy, future, otherFuture]);
  assert.match(calendarFile(after.dated), /UID:a-2028@festival-radar/);
  assert.equal(state.attendance.a, "going");
});
