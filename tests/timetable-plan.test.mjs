import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPerformanceSelections,
  parsePerformanceSelections,
  runningOrderCalendar,
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

test("calendar export uses stable edition UIDs, exact instants and only scheduled verified sets", () => {
  const entry = {
    sourcePerformanceId: "fixture:set.7",
    artist: "Группа ".repeat(20) + "Last, title",
    stage: "Stage;West",
    observedAt: "2027-06-01T20:00:00Z",
    status: "scheduled",
    window: { startsAt: "2027-06-10T23:30:00+02:00", endsAt: "2027-06-11T00:30:00+02:00" },
  };
  const cancelled = { ...entry, status: "cancelled", artist: "Canceled fixture" };
  const unknown = { ...entry, window: undefined, artist: "No end fixture" };
  assert.equal(runningOrderCalendar([cancelled, unknown], "fixture", 2027), null);
  const calendar = runningOrderCalendar([unknown, entry, cancelled], "fixture", 2027);
  const lines = calendar.split("\r\n");
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.ok(lines.includes("UID:performance:2027:fixture:fixture%3Aset.7@festival-radar"));
  assert.ok(lines.includes("DTSTAMP:20270601T200000Z"));
  assert.ok(lines.includes("DTSTART:20270610T213000Z"));
  assert.ok(lines.includes("DTEND:20270610T223000Z"));
  assert.ok(lines.includes("LOCATION:Stage\\;West"));
  assert.match(calendar.replace(/\r\n /g, ""), /Last\\, title/);
});
