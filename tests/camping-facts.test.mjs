import assert from "node:assert/strict";
import test from "node:test";
import { campingSourceHost } from "../lib/catalog/camping-facts.ts";
import { campingObservation, publishCampingObservation } from "../lib/catalog/camping-import.ts";

test("camping source identity requires credential-free HTTPS on the normal port", () => {
  assert.equal(campingSourceHost("https://www.organizer.example/camping"), "organizer.example");
  for (const url of [
    "not a URL",
    "http://organizer.example",
    "https://user@organizer.example",
    "https://organizer.example:444",
  ]) {
    assert.equal(campingSourceHost(url), undefined);
  }
});

test("camping rejects foreign sources, invalid dates and duplicate fields before DB access", async () => {
  const arrival = { field: "arrival", earliestDate: "2027-08-05" };
  const record = {
    editionId: "edition",
    festivalSlug: "fixture",
    editionYear: 2027,
    city: "Fixture City",
    countryCode: "DE",
    organizerHost: "organizer.example",
    sourceUrl: "https://organizer.example/camping",
    checkedOn: "2026-11-23",
    facts: [arrival],
  };
  await assert.rejects(
    publishCampingObservation(null, { ...record, sourceUrl: "https://unrelated.example" }),
    /primary source/,
  );
  assert.throws(
    () =>
      campingObservation.parse({ ...record, facts: [{ ...arrival, earliestDate: "2027-02-29" }] }),
    /Invalid ISO date/,
  );
  await assert.rejects(
    publishCampingObservation(null, { ...record, facts: [arrival, arrival] }),
    /appear once/,
  );
});

test("unknown city cannot match a reviewed camping location", async () => {
  const { readCampingFacts } = await import("../lib/catalog/camping-facts.ts");
  assert.deepEqual(
    await readCampingFacts(null, {
      slug: "fixture",
      editionYear: 2027,
      city: undefined,
      countryCode: "DE",
      officialUrl: "https://organizer.example/",
    }),
    [],
  );
});
