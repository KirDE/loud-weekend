import assert from "node:assert/strict";
import test from "node:test";
import { festivalMapPoint } from "../lib/festival-map.ts";

test("map positions use longitude first and preserve zero and signed coordinates", () => {
  assert.deepEqual(
    festivalMapPoint({ coordinates: { latitude: 48.5, longitude: -2 } }),
    [-2, 48.5],
  );
  assert.deepEqual(festivalMapPoint({ coordinates: { latitude: 0, longitude: 0 } }), [0, 0]);
});

test("unknown, malformed and non-projectable locations do not get a marker", () => {
  assert.equal(festivalMapPoint({}), undefined);
  for (const coordinates of [
    { latitude: undefined, longitude: 10 },
    { latitude: 50, longitude: 181 },
    { latitude: 90, longitude: 14 },
    { latitude: Infinity, longitude: 0 },
    { latitude: 47, longitude: NaN },
  ])
    assert.equal(festivalMapPoint({ coordinates }), undefined);
});
