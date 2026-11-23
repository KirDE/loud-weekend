import assert from "node:assert/strict";
import test from "node:test";
import { listOfflineTrips, offlineTripKey, parseOfflineTrip, readOfflineTrip, saveOfflineTrip } from "../public/offline-trips.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const updatedAt = "2026-11-01T12:00:00.000Z";
const fact = {
  version: 1, slug: "festival", year: 2027, name: "Sample Festival",
  startDate: "2027-06-10", endDate: "2027-06-12", location: "Sample City", updatedAt,
  timetable: [{ date: "2027-06-10", start: "20:30", stage: "Main", artist: "Artist", timeZone: "Europe/Berlin", status: "cancelled", checkedAt: updatedAt }],
};

test("trip storage retains only public allowlisted fields and is edition scoped", () => {
  const storage = memoryStorage();
  storage.setItem("unrelated", "private");
  const value = saveOfflineTrip(storage, { ...fact, internal: "not stored", timetable: [{ ...fact.timetable[0], sourceUrl: "not stored" }] }, updatedAt);
  assert.deepEqual(value, { savedAt: updatedAt, trip: fact });
  assert.deepEqual(readOfflineTrip(storage, "festival", 2027), value);
  assert.equal(readOfflineTrip(storage, "festival", 2028), null);
  assert.deepEqual(listOfflineTrips(storage), [value]);

  const next = { ...fact, year: 2028, startDate: null, endDate: null, timetable: [] };
  saveOfflineTrip(storage, next, updatedAt);
  storage.removeItem(offlineTripKey("festival", 2028));
  assert.equal(listOfflineTrips(storage).length, 1);
  assert.equal(storage.getItem("unrelated"), "private");
});

test("bad input, quota errors and wrong-key records never replace the last good download", () => {
  const storage = memoryStorage();
  const saved = saveOfflineTrip(storage, fact, updatedAt);
  const bad = { ...fact, startDate: "2027-02-30" };
  assert.equal(parseOfflineTrip(bad), null);
  assert.throws(() => saveOfflineTrip(storage, bad));
  const invalidSlot = { ...fact, timetable: [{ ...fact.timetable[0], checkedAt: null }] };
  assert.equal(parseOfflineTrip(invalidSlot), null);
  storage.setItem(offlineTripKey("festival", 2028), JSON.stringify(saved));
  assert.deepEqual(listOfflineTrips(storage), [saved]);
  storage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  assert.throws(() => saveOfflineTrip(storage, { ...fact, name: "new" }), { name: "QuotaExceededError" });
  assert.deepEqual(readOfflineTrip(storage, "festival", 2027), saved);
});
