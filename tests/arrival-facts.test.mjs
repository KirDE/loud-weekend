import assert from "node:assert/strict";
import test from "node:test";
import { arrivalSourceHost, readArrivalFacts } from "../lib/catalog/arrival-facts.ts";

test("arrival sources use the same credential-free HTTPS organizer identity", () => {
  assert.equal(arrivalSourceHost("https://www.organizer.example/travel"), "organizer.example");
  for (const input of [
    "not a URL",
    "http://organizer.example",
    "https://user@organizer.example",
    "https://organizer.example:444",
  ]) {
    assert.equal(arrivalSourceHost(input), undefined, input);
  }
  assert.notEqual(arrivalSourceHost("https://organizer.example.other.test"), "organizer.example");
});

test("public arrival guidance skips paused editions without removing historical or active facts", async () => {
  const item = {
    slug: "synthetic-arrival",
    editionYear: 2030,
    countryCode: "DE",
    officialUrl: "https://organizer.example/",
  };
  const pause = {
    festivalSlug: item.slug,
    editionYear: item.editionYear,
    lifecycle: "hiatus",
    announcedReturnYear: null,
    alternativeEvent: null,
    sourceUrl: item.officialUrl,
    observedAt: "2029-10-01T12:00:00.000Z",
    approvedAt: "2029-10-02T12:00:00.000Z",
  };
  const row = {
    editionYear: item.editionYear,
    countryCode: item.countryCode,
    organizerHost: "organizer.example",
    kind: "shuttle",
    descriptionEn: "Verified shuttle",
    descriptionDe: "Bestätigter Shuttle",
    descriptionRu: "Подтверждённый шаттл",
    sourceUrl: item.officialUrl + "shuttle",
    checkedOn: new Date("2029-09-01"),
  };
  let reads = 0;
  const db = {
    editionArrivalFact: {
      async findMany({ where }) {
        reads++;
        assert.equal(where.editionYear, item.editionYear);
        assert.equal(where.edition.festival.slug, item.slug);
        return [row, { ...row, editionYear: 2029 }];
      },
    },
  };
  for (const paused of [
    { ...item, editionLifecycle: pause },
    { ...item, recordState: "current", editionLifecycle: pause },
  ]) {
    assert.deepEqual(await readArrivalFacts(db, paused), []);
  }
  assert.equal(reads, 0);

  const expected = [
    {
      kind: row.kind,
      description: { en: row.descriptionEn, de: row.descriptionDe, ru: row.descriptionRu },
      sourceUrl: row.sourceUrl,
      checkedOn: "2029-09-01",
    },
  ];
  assert.deepEqual(await readArrivalFacts(db, { ...item, recordState: "current" }), expected);
  assert.deepEqual(
    await readArrivalFacts(db, { ...item, recordState: "archived", editionLifecycle: pause }),
    expected,
  );
  assert.equal(reads, 2);
});
