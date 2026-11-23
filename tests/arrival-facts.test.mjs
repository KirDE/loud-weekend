import assert from "node:assert/strict";
import test from "node:test";
import { arrivalFacts, arrivalRecords } from "../lib/catalog/arrival-facts.ts";

test("each arrival record requires matching catalogue edition and official identity", () => {
  for (const record of arrivalRecords) {
    const festival = {
      slug: record.slug, editionYear: record.year, countryCode: record.countryCode,
      officialUrl: `https://www.${record.organizer}/`,
    };
    assert.equal(arrivalFacts(festival), record);
    for (const changes of [
      { editionYear: 2026 }, { editionYear: undefined }, { countryCode: "ZZ" }, { slug: "other" },
      { officialUrl: "not a URL" }, { officialUrl: `http://${record.organizer}/` },
      { officialUrl: `https://${record.organizer}.example.org/` },
      { officialUrl: `https://user@${record.organizer}/` },
      { officialUrl: `https://${record.organizer}:444/` },
    ]) {
      assert.equal(arrivalFacts({ ...festival, ...changes }), undefined, JSON.stringify(changes));
    }
    for (const fact of record.facts) {
      assert.equal(new URL(fact.source).hostname, `www.${record.organizer}`);
      assert.ok(["en", "de", "ru"].every(language => fact.description[language]));
    }
  }
});
