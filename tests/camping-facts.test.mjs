import assert from "node:assert/strict";
import test from "node:test";
import { campingFacts, campingRecords } from "../lib/catalog/camping-facts.ts";

for (const record of campingRecords) {
  test(`camping facts require the exact published edition and organizer: ${record.slug}`, () => {
    const officialUrl = `https://www.${record.organizer}/`;
    const fixture = { slug: record.slug, city: record.city, editionYear: record.year, officialUrl };
    assert.equal(campingFacts(fixture), record);
    assert.equal(new URL(record.source).hostname.replace(/^www\./, ""), record.organizer);
    for (const change of [{ editionYear: 2026 }, { editionYear: undefined }, { city: "Unknown" },
      { slug: "another-event" }, { officialUrl: "https://festival.example.test" }, { officialUrl: "invalid" }]) {
      assert.equal(campingFacts({ ...fixture, ...change }), undefined);
    }
    for (const fact of record.facts) {
      if (fact.field === "arrival") {
        assert.equal(fact.earliestDate.slice(0, 4), String(record.year));
      } else {
        assert.ok(["en", "de", "ru"].every(lang => fact.description[lang]));
      }
    }
  });
}
