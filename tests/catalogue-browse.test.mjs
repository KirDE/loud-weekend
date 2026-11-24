import assert from "node:assert/strict";
import test from "node:test";
import { catalogueBrowse } from "../lib/catalog/browse.ts";

test("browse lists only recorded countries, overlapping months, edition years and public artist keys", () => {
  const festivals = [
    { countryCode: "DE", startDate: "2027-06-30", endDate: "2027-07-02" },
    { countryCode: "DE", startDate: "2027-06-15" },
    { countryCode: "CZ" },
  ];
  const editions = [
    { editionYear: 2027, recordState: "current" },
    { editionYear: 2027, recordState: "current" },
  ];
  const artists = [{ slug: "artist-a", name: "Artist A", internalEvidence: "not needed" }];
  assert.deepEqual(catalogueBrowse(festivals, editions, artists), {
    countries: ["DE", "CZ"],
    months: [6, 7],
    years: [2027],
    hasArchive: false,
    artists: [{ slug: "artist-a", name: "Artist A" }],
  });
  const archive = { editionYear: 2025, recordState: "archived" };
  const future = { editionYear: 2029, recordState: "tracking" };
  const complete = catalogueBrowse(festivals, [...editions, archive, future], artists);
  assert.equal(complete.hasArchive, true);
  assert.deepEqual(complete.years, [2029, 2027, 2025]);
});
