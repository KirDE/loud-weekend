import assert from "node:assert/strict";
import test from "node:test";
import {
  dateShareQuery, datesFromQuery, matchesDiscoveryDates, readDiscoveryDates, removeDateQuery,
} from "../lib/discovery-dates.ts";

const event = { startDate: "2027-06-30", endDate: "2027-07-03" };
const matches = (event, filters) => matchesDiscoveryDates(event, readDiscoveryDates(filters));

test("date ranges overlap across months and include both boundaries", () => {
  assert.equal(matches(event, { dateFrom: "2027-07-01", dateTo: "2027-07-02" }), true);
  assert.equal(matches(event, { dateFrom: "2027-07-03" }), true);
  assert.equal(matches(event, { dateTo: "2027-06-30" }), true);
  assert.equal(matches(event, { dateFrom: "2027-07-04" }), false);
  assert.equal(matches(event, { dateTo: "2027-06-29" }), false);
  assert.equal(matches(event, { dateFrom: "2027-07-02", dateTo: "2027-07-01" }), false);
});

test("weekend checks the overlap and maximum duration counts the entire inclusive event", () => {
  assert.equal(matches(event, { weekendOnly: true, dateTo: "2027-07-02" }), false);
  assert.equal(matches(event, { weekendOnly: true, dateFrom: "2027-07-03" }), true);
  assert.equal(matches({ startDate: "2027-07-04" }, { weekendOnly: true, maxDays: "1" }), true);
  assert.equal(matches(event, { dateFrom: "2027-07-03", maxDays: "3" }), false);
  assert.equal(matches(event, { dateFrom: "2027-07-03", maxDays: "4" }), true);
  assert.equal(matches({ startDate: "2028-02-28", endDate: "2028-03-01" }, { maxDays: "3" }), true);
});

test("unknown dates are visible only without date constraints; malformed link values are ignored", () => {
  assert.equal(matches({}, {}), true);
  assert.equal(matches({}, { weekendOnly: true }), false);
  assert.equal(matches({}, { maxDays: "7" }), false);
  assert.equal(matches({ startDate: "2027-02-29" }, { maxDays: "7" }), false);
  assert.equal(datesFromQuery(new URLSearchParams("dateFrom=2027-02-29&weekend=true&maxDays=0")), null);
  assert.equal(datesFromQuery(new URLSearchParams("dateFrom=2027-06-30&dateTo=2027-06-01")), null);
});

test("date links round-trip only date controls and can be removed without disturbing other parameters", () => {
  const filters = readDiscoveryDates({ dateFrom: "2028-02-29", dateTo: "2028-03-05", weekendOnly: true, maxDays: "10" });
  const query = dateShareQuery({ ...filters, query: "private search" });
  assert.deepEqual(datesFromQuery(new URLSearchParams(query)), filters);
  assert.equal(query.includes("private"), false);
  const url = new URL(`https://example.test/en/?${query}&other=keep#content`);
  removeDateQuery(url);
  assert.equal(url.href, "https://example.test/en/?other=keep#content");
});
