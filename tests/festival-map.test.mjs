import assert from "node:assert/strict";
import test from "node:test";
import { publicFestivalVenue } from "../lib/catalog/festival-venues.ts";
import { festivalMapPoint } from "../lib/festival-map.ts";

test("map positions use longitude first and preserve zero and signed coordinates", () => {
  assert.deepEqual(
    festivalMapPoint({ coordinates: { latitude: 48.5, longitude: -2 } })?.coordinates,
    [-2, 48.5],
  );
  assert.deepEqual(
    festivalMapPoint({ coordinates: { latitude: 0, longitude: 0 } })?.coordinates,
    [0, 0],
  );
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

const row = {
  editionYear: 2027,
  countryCode: "CZ",
  city: "Jaroměř",
  organizerHost: "organizer.example",
  name: "Fixture Venue",
  sourceUrl: "https://organizer.example/venue",
  checkedOn: new Date("2026-11-23"),
  latitude: 50.340428,
  longitude: 15.935361,
};
const festival = {
  editionYear: 2027,
  countryCode: "CZ",
  city: "Jaromer",
  officialUrl: "https://www.organizer.example/",
  coordinates: { latitude: 50, longitude: 15 },
};

test("persisted organizer coordinates take precedence over approximate catalogue coordinates", () => {
  const venue = publicFestivalVenue(row, festival);
  assert.deepEqual(festivalMapPoint({ ...festival, venue }).coordinates, [15.935361, 50.340428]);
  assert.equal(venue.source, row.sourceUrl);
  assert.equal(venue.checkedOn, "2026-11-23");
  assert.equal(festivalMapPoint({ venue }).venue.name, row.name);
});

test("ineligible venue evidence keeps the approximate marker", () => {
  for (const change of [
    { editionYear: 2028 },
    { officialUrl: "https://organizer.example.other.test/" },
    { officialUrl: "not a URL" },
    { officialUrl: "https://user@organizer.example/" },
    { city: "Prague" },
    { editionYear: undefined },
    { countryCode: "DE" },
  ]) {
    const venue = publicFestivalVenue(row, { ...festival, ...change });
    assert.equal(venue, undefined);
    assert.deepEqual(festivalMapPoint({ ...festival, venue }).coordinates, [15, 50]);
  }
  assert.equal(
    publicFestivalVenue({ ...row, sourceUrl: "https://other.test/venue" }, festival),
    undefined,
  );
});
