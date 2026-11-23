import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { festival } from "./support/catalog.ts";
import { findTimetableConflicts, groupTimetable, timetableLocalDateTime, validateFestivalTimetable } from "../lib/timetables.ts";

const base = { date: "2027-06-10", stage: "Faster", start: "18:30", artist: "Sample Artist", timeZone: "Europe/Berlin", status: "scheduled", sourceUrl: "https://festival.example.test/", observedAt: "2027-06-01T10:00:00.000Z" };

test("populated timetables validate provenance, dates and timezone", () => {
  assert.ok(festival);
  assert.deepEqual(validateFestivalTimetable(festival, [base]), [base]);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, sourceUrl: "https://example.test/" }]), /not under the festival official URL/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, timeZone: "Moon/Base" }]), /IANA/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, date: "2027-02-30" }]), /real calendar date/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, date: "2027-08-01" }]), /follows festival end/);
  assert.throws(() => validateFestivalTimetable(festival, [base, base]), /duplicate timetable row/);
});

test("rows are grouped by date and stage and sorted by local start time", () => {
  const grouped = groupTimetable([
    { ...base, start: "20:00", artist: "Later" },
    { ...base, stage: "Louder", start: "17:00", artist: "Other stage" },
    { ...base, start: "17:30", artist: "Earlier" },
  ]);
  assert.equal(grouped[0].date, "2027-06-10");
  assert.deepEqual(grouped[0].stages.map(({ stage }) => stage), ["Faster", "Louder"]);
  assert.deepEqual(grouped[0].stages[0].entries.map(({ artist }) => artist), ["Earlier", "Later"]);
});

test("conflicting scheduled rows are rejected while cancellations remain visible", () => {
  assert.equal(findTimetableConflicts([base, { ...base, artist: "Other artist" }]).length, 1);
  assert.throws(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist" }]), /conflict/);
  assert.doesNotThrow(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist", status: "cancelled" }]));
});

test("the DB importer rejects missing database configuration without mutating its input", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-timetable-"));
  const input = path.join(directory, "input.json");
  await writeFile(input, JSON.stringify({ festivalSlug: festival.slug, entries: [base] }));
  try {
    const before = await readFile(input, "utf8");
    const result = spawnSync(process.execPath, ["scripts/import-timetable.mjs", `--input=${input}`, "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_URL/);
    assert.equal(await readFile(input, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("only exact verified windows become schedule ranges, including overnight and DST offsets", () => {
  const overnight = {
    ...base, start: "23:45",
    window: { startsAt: "2027-06-10T21:45:00Z", endsAt: "2027-06-11T00:15:00+02:00" },
  };
  const checked = validateFestivalTimetable(festival, [overnight]);
  assert.deepEqual(checked[0].window, overnight.window);
  assert.equal(validateFestivalTimetable(festival, [base])[0].window, undefined);
  const fallBack = {
    ...base, date: "2027-10-31", start: "02:30",
    window: { startsAt: "2027-10-31T02:30:00+02:00", endsAt: "2027-10-31T02:15:00+01:00" },
  };
  assert.doesNotThrow(() => validateFestivalTimetable({ ...festival, startDate: undefined, endDate: undefined }, [fallBack]));
  assert.notEqual(
    timetableLocalDateTime(fallBack.window.startsAt, fallBack.timeZone).offset,
    timetableLocalDateTime(fallBack.window.endsAt, fallBack.timeZone).offset,
  );
  for (const invalid of [
    { ...overnight, start: "23:46" },
    { ...overnight, status: "cancelled" },
    { ...overnight, window: { ...overnight.window, endsAt: undefined } },
    { ...overnight, window: { ...overnight.window, endsAt: "2027-06-11T00:15:00" } },
    { ...overnight, window: { ...overnight.window, endsAt: "2027-06-10T23:30:00+02:00" } },
    { ...overnight, window: { ...overnight.window, endsAt: "2027-06-12T00:15:00+02:00" } },
  ]) {
    assert.throws(() => validateFestivalTimetable(festival, [invalid]), /window/);
  }
});

test("public organizer IDs are optional, bounded and unique within the edition import", () => {
  assert.equal(validateFestivalTimetable(festival, [base])[0].sourcePerformanceId, undefined);
  const identified = { ...base, sourcePerformanceId: "official:set.42" };
  assert.equal(validateFestivalTimetable(festival, [identified])[0].sourcePerformanceId, "official:set.42");
  assert.throws(() => validateFestivalTimetable(festival, [identified, { ...identified, stage: "Other Stage" }]), /duplicate organizer performance ID/);
  for (const sourcePerformanceId of ["auto relative path", "", "x".repeat(129)]) {
    assert.throws(() => validateFestivalTimetable(festival, [{ ...base, sourcePerformanceId }]), /sourcePerformanceId/);
  }
});
