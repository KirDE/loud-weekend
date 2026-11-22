import assert from "node:assert/strict";
import test from "node:test";
import { notificationEventsForChanges, uniqueNotificationEvents } from "../lib/ingestion/notification-events.ts";
import { nextDigest } from "../lib/notification-schedule.ts";

const festival = { slug: "test-fest", name: "Test Fest", country: "Germany", countryCode: "DE", officialUrl: "https://example.test", headliners: [], lineup: [], status: "confirmed", editionYear: 2027 };

test("publication maps every supported event type to stable edition-aware keys", () => {
  const changes = [
    { kind: "artist_added", field: "lineup", after: "New Band", reviewRequired: false },
    { kind: "artist_removed", field: "lineup", before: "Gone Band", reviewRequired: true },
    { kind: "date_changed", field: "startDate", before: "2027-01-01", after: "2027-01-02", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "unknown", after: "available", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "available", after: "low", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "low", after: "sold_out", reviewRequired: false },
    { kind: "timetable_published", field: "timetable", after: "42", reviewRequired: false },
  ];
  const first = notificationEventsForChanges(festival, changes, "2026-08-29T19:15:00.000Z");
  const second = notificationEventsForChanges(festival, changes, "2026-08-29T19:16:00.000Z");
  assert.deepEqual(new Set(first.map(({ type }) => type)), new Set(["ARTIST_ADDED", "ARTIST_CANCELLED", "FESTIVAL_DATE_MOVED", "TICKETS_ON_SALE", "TICKETS_LOW", "TICKETS_SOLD_OUT", "TIMETABLE_PUBLISHED"]));
  assert.deepEqual(first.map(({ dedupeKey }) => dedupeKey), second.map(({ dedupeKey }) => dedupeKey));
  assert.ok(first.every(({ dedupeKey, festivalId }) => dedupeKey.includes(":2027:") && festivalId === "test-fest:2027"));
});

test("duplicate keys keep first event and original order", () => {
  const changes = [
    { kind: "date_changed", field: "startDate", after: "2027-07-07", reviewRequired: false },
    { kind: "date_changed", field: "endDate", after: "2027-07-07", reviewRequired: false },
    { kind: "tickets_changed", field: "ticketsUrl", after: "https://example.test/tickets", reviewRequired: false },
  ];
  const events = notificationEventsForChanges(festival, changes, "2026-08-29T19:15:00.000Z");
  assert.equal(events[0].dedupeKey, events[1].dedupeKey);
  const unique = uniqueNotificationEvents(events);
  assert.deepEqual(unique, [events[0], events[2]]);
  assert.equal(unique[0].payload.change.field, "startDate");
});

test("digest schedule is daily 08:00 UTC and weekly Monday 08:00 UTC", () => {
  assert.equal(nextDigest("DAILY", new Date("2026-08-29T07:00:00Z")).toISOString(), "2026-08-29T08:00:00.000Z");
  assert.equal(nextDigest("DAILY", new Date("2026-08-29T09:00:00Z")).toISOString(), "2026-08-30T08:00:00.000Z");
  assert.equal(nextDigest("WEEKLY", new Date("2026-08-29T09:00:00Z")).toISOString(), "2026-08-31T08:00:00.000Z");
  assert.equal(nextDigest("WEEKLY", new Date("2026-08-31T09:00:00Z")).toISOString(), "2026-09-07T08:00:00.000Z");
});


test("only explicit sellouts create sold-out notifications", () => {
  const festival = { slug: "ticket-fixture", name: "Synthetic ticket fixture", editionYear: 2027 };
  for (const status of ["unknown", "unavailable", "not_on_sale", "sales_ended", "free"]) {
    assert.deepEqual(notificationEventsForChanges(festival, [{ kind: "ticket_status_changed", field: "ticketStatus", before: "available", after: status, reviewRequired: false }], "2026-11-17T00:00:00Z"), []);
  }
  const changes = [{ kind: "ticket_status_changed", field: "ticketStatus", before: "low", after: "sold_out", reviewRequired: false }];
  const first = notificationEventsForChanges(festival, changes, "2026-11-17T00:00:00Z");
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "TICKETS_SOLD_OUT");
  assert.equal(first[0].payload.change.after, "sold_out");
  assert.deepEqual(first.map(event => event.dedupeKey), notificationEventsForChanges(festival, changes, "2026-11-18T00:00:00Z").map(event => event.dedupeKey));
});


test("free admission and ancillary URL changes never announce ticket sales", () => {
  const changes = [{ kind: "tickets_changed", field: "ticketsUrl", after: "https://example.test/camping", reviewRequired: false }];
  const at = "2026-11-22T15:00:00Z";
  assert.deepEqual(notificationEventsForChanges({ ...festival, ticketStatus: "free" }, changes, at), []);
  assert.deepEqual(notificationEventsForChanges(festival, [...changes, { kind: "ticket_status_changed", field: "ticketStatus", after: "free", reviewRequired: false }], at), []);
  const paid = {kind: "ticket_status_changed", field: "ticketStatus", before: "free", after: "available", reviewRequired: false};
  assert.deepEqual(notificationEventsForChanges({ ...festival, ticketStatus: "free" }, [paid], at).map(e => e.type), ["TICKETS_ON_SALE"]);
  const artist = {kind: "artist_added", field: "lineup", after: "Synthetic Band", reviewRequired: false};
  assert.deepEqual(notificationEventsForChanges({ ...festival, ticketStatus: "free" }, [...changes, artist], at).map(e => e.type), ["ARTIST_ADDED"]);
});
