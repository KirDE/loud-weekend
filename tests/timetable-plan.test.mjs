import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPerformanceSelections,
  orderPerformanceSelections,
  parsePerformanceSelections,
  togglePerformanceSelection,
} from "../lib/timetable-plan.ts";

test("running orders retain only distinct valid organizer IDs", () => {
  assert.deepEqual(parsePerformanceSelections('["set:3","set:3","not valid",1,"set.2"]'), [
    "set:3",
    "set.2",
  ]);
  assert.deepEqual(parsePerformanceSelections('{"fake":true}'), []);
  assert.deepEqual(parsePerformanceSelections("invalid json"), []);
  assert.deepEqual(togglePerformanceSelection(["set:3"], "set:3"), []);
  assert.deepEqual(togglePerformanceSelection(["set:3"], "set:4"), ["set:3", "set:4"]);
});

test("clashes require verified half-open UTC windows for both scheduled performances", () => {
  const range = (artist, startsAt, endsAt, status = "scheduled") => ({
    artist,
    status,
    window: { startsAt, endsAt },
  });
  const first = range("First", "2027-06-10T23:30:00+02:00", "2027-06-11T00:30:00+02:00");
  const overlap = range("Overlap", "2027-06-10T22:20:00Z", "2027-06-10T22:30:00Z");
  const touching = range("Touching", "2027-06-10T22:30:00Z", "2027-06-10T23:30:00Z");
  const cancelled = range("Cancelled", "2027-06-10T22:20:00Z", "2027-06-10T22:30:00Z", "cancelled");
  const unknown = { artist: "Unknown", status: "scheduled" };
  assert.deepEqual(assessPerformanceSelections([touching, unknown, cancelled, overlap, first]), {
    conflicts: [[first, overlap]],
    incomplete: true,
  });
  assert.deepEqual(assessPerformanceSelections([first, touching, cancelled]), {
    conflicts: [],
    incomplete: false,
  });
});

test("saved performances follow verified instants through a repeated local hour", () => {
  const entry = (artist, start, startsAt) => ({
    artist,
    date: "2027-10-31",
    start,
    ...(startsAt ? { window: { startsAt } } : {}),
  });
  const first = entry("First", "02:50", "2027-10-31T02:50:00+02:00");
  const second = entry("Second", "02:10", "2027-10-31T02:10:00+01:00");
  const early = entry("Early", "01:30");
  const unknown = entry("Unknown occurrence", "02:20");
  const late = entry("Late", "03:10");
  const inputs = [late, first, unknown, second, early];
  assert.deepEqual(orderPerformanceSelections(inputs), [early, first, unknown, second, late]);
  assert.deepEqual(inputs, [late, first, unknown, second, early]);
});
