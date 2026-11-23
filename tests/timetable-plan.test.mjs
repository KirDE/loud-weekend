import assert from "node:assert/strict";
import test from "node:test";
import { assessPerformanceSelections, parsePerformanceSelections, togglePerformanceSelection } from "../lib/timetable-plan.ts";

test("running orders retain only distinct valid organizer IDs", () => {
  assert.deepEqual(parsePerformanceSelections('["set:3","set:3","not valid",1,"set.2"]'), ["set:3", "set.2"]);
  assert.deepEqual(parsePerformanceSelections('{"fake":true}'), []);
  assert.deepEqual(parsePerformanceSelections("invalid json"), []);
  assert.deepEqual(togglePerformanceSelection(["set:3"], "set:3"), []);
  assert.deepEqual(togglePerformanceSelection(["set:3"], "set:4"), ["set:3", "set:4"]);
});

test("clashes require verified half-open UTC windows for both scheduled performances", () => {
  const range = (artist, startsAt, endsAt, status = "scheduled") => ({ artist, status, window: { startsAt, endsAt } });
  const first = range("First", "2027-06-10T23:30:00+02:00", "2027-06-11T00:30:00+02:00");
  const overlap = range("Overlap", "2027-06-10T22:20:00Z", "2027-06-10T22:30:00Z");
  const touching = range("Touching", "2027-06-10T22:30:00Z", "2027-06-10T23:30:00Z");
  const cancelled = range("Cancelled", "2027-06-10T22:20:00Z", "2027-06-10T22:30:00Z", "cancelled");
  const unknown = { artist: "Unknown", status: "scheduled" };
  assert.deepEqual(assessPerformanceSelections([touching, unknown, cancelled, overlap, first]), {
    conflicts: [[first, overlap]], incomplete: true,
  });
  assert.deepEqual(assessPerformanceSelections([first, touching, cancelled]), { conflicts: [], incomplete: false });
});
