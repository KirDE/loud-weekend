import assert from "node:assert/strict";
import test from "node:test";
import { personalCalendar } from "../lib/personal-calendar.ts";
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
  const result = personalCalendar([c, b, a, unknown, invalid, d], {
    a: "going",
    b: "maybe",
    c: "going",
    d: "not-going",
    unknown: "maybe",
    invalid: "going",
  });
  assert.deepEqual(result.dated, [a, b, c]);
  assert.deepEqual(result.undated, [unknown, invalid]);
  assert.deepEqual(result.conflicts, [
    { first: a, second: b, range: { startDate: "2027-07-02", endDate: "2027-07-02" } },
  ]);
  const ics = calendarFile(result.dated);
  assert.match(
    ics,
    /UID:a-2027@festival-radar\r\nDTSTART;VALUE=DATE:20270630\r\nDTEND;VALUE=DATE:20270703/,
  );
  assert.doesNotMatch(ics, /UID:(d|unknown|invalid)-/);
});

test("reports all pairs when three selected festivals overlap, independent of catalogue order", () => {
  const rows = ["c", "b", "a"].map((slug) => festival(slug, "2027-07-01", "2027-07-02"));
  const { conflicts } = personalCalendar(rows, { a: "going", b: "going", c: "maybe" });
  assert.deepEqual(
    conflicts.map(({ first, second }) => [first.slug, second.slug]),
    [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ],
  );
});
