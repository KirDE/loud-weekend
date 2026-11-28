import assert from "node:assert/strict";
import test from "node:test";
import { calendarFile, calendarUrls } from "../lib/planning.ts";

const festival = {
  slug: "test-fest",
  name: "Test, Rock; Fest",
  country: "Germany",
  countryCode: "DE",
  city: "Köln",
  startDate: "2027-06-04",
  endDate: "2027-06-06",
  headliners: [],
  lineup: [],
  officialUrl: "https://example.com/fest",
  status: "confirmed",
  editionYear: 2027,
  updatedAt: "2026-11-22T15:35:17.298Z",
};

test("calendar export uses an exclusive end date and escaped text", () => {
  const payload = calendarFile([festival]);
  assert.match(payload, /DTSTART;VALUE=DATE:20270604/);
  assert.match(payload, /DTEND;VALUE=DATE:20270607/);
  assert.match(payload, /SUMMARY:Test\\, Rock\\; Fest/);
  assert.match(payload, /LOCATION:Köln\\, Germany/);
  assert.match(payload, /UID:test-fest-2027@festival-radar\r\nDTSTAMP:20261122T153517Z\r\n/);
  assert.equal(payload.match(/^DTSTAMP:/gm).length, 1);
});

test("calendar links provide distinct explicit Google, ICS and Apple flows", () => {
  const links = calendarUrls(festival);
  assert.ok(links);
  assert.match(links.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(links.ics, /^data:text\/calendar;charset=utf-8,/);
  assert.match(links.apple, /^data:text\/calendar;charset=utf-8,/);
  assert.equal(decodeURIComponent(links.apple.split(",", 2)[1]), calendarFile([festival]));
});

test("undated festivals do not expose invalid calendar actions", () => {
  assert.equal(calendarUrls({ ...festival, startDate: undefined, endDate: undefined }), null);
});

test("calendar stamps normalize offsets and fall back when a source stamp is invalid", () => {
  assert.match(
    calendarFile([{ ...festival, calendarUpdatedAt: "2026-11-22T16:35:18+01:00" }]),
    /DTSTAMP:20261122T153518Z\r\n/,
  );
  const generatedAt = new Date("2026-11-23T10:00:15.034Z");
  assert.match(
    calendarFile([{ ...festival, updatedAt: "not a date" }], generatedAt),
    /DTSTAMP:20261123T100015Z\r\n/,
  );
});

test("calendar links and files omit malformed or reversed ranges without dropping valid events", () => {
  const invalid = [
    { ...festival, slug: "bad-start", startDate: "2027-02-29" },
    { ...festival, slug: "bad-end", endDate: "not a date" },
    { ...festival, slug: "backwards", endDate: "2027-06-03" },
    { ...festival, slug: "out-of-range", startDate: "9999-12-31", endDate: undefined },
  ];
  for (const item of invalid) assert.equal(calendarUrls(item), null);
  const payload = calendarFile([...invalid, festival]);
  assert.equal(payload.match(/^BEGIN:VEVENT\r$/gm).length, 1);
  assert.match(payload, /UID:test-fest-2027@festival-radar/);
});

test("single-day calendar actions agree across a calendar year boundary", () => {
  const item = { ...festival, startDate: "2027-12-31", endDate: undefined };
  const google = new URL(calendarUrls(item).google);
  assert.equal(google.searchParams.get("dates"), "20271231/20280101");
  assert.match(calendarFile([item]), /DTEND;VALUE=DATE:20280101/);
});

test("calendar identity distinguishes an unknown edition from the verified 2027 season", () => {
  const unknown = { ...festival, editionYear: undefined };
  const next = { ...festival, editionYear: 2028 };
  const payload = calendarFile([festival, unknown, next]);
  assert.deepEqual(
    [...payload.matchAll(/^UID:([^\r]+)\r$/gm)].map((match) => match[1]),
    [
      "test-fest-2027@festival-radar",
      "test-fest-unknown-edition@festival-radar",
      "test-fest-2028@festival-radar",
    ],
  );
  for (const editionYear of [0, Number.NaN, 2028.5]) {
    assert.match(
      calendarFile([{ ...unknown, editionYear, startDate: "2027-06-05" }]),
      /UID:test-fest-unknown-edition@festival-radar/,
    );
  }
  assert.match(
    calendarFile([{ ...unknown, calendarId: "stored-edition" }]),
    /UID:stored-edition@festival-radar/,
  );
});
