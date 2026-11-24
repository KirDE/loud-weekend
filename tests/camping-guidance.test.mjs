import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCampingGuidance } from "../lib/ingestion/adapters/camping-guidance.ts";

const fixture = (slug) =>
  readFileSync(new URL(`./fixtures/camping/${slug}.html`, import.meta.url), "utf8");
for (const [slug, before, after, date] of [
  ["alcatraz", /Thursday 5/g, "Friday 6", "2027-08-06"],
  ["wacken-open-air", /Monday, July 26/, "Tuesday, July 27", "2027-07-27"],
]) {
  const page = fixture(slug);
  const parse = (html) => parseCampingGuidance(html, slug, 2027);
  test(`${slug}: the parsed arrival changes with the organizer date`, () => {
    assert.ok(parse(page));
    assert.ok(parse(page.replace(before, after)).some((fact) => fact.earliestDate === date));
  });
  test(`${slug}: absent, hidden or wrong-edition guidance is not replaced by fixed facts`, () => {
    assert.equal(parse(page.replaceAll("2027", "2026")), undefined);
    assert.equal(parse(page.replace(/<p>/g, "<p hidden>")), undefined);
    assert.equal(
      parse(
        page.replaceAll(
          /(?:compulsory for every camper|included in your festival ticket)/g,
          "confirmation pending",
        ),
      ),
      undefined,
    );
  });
}

test("Graspop adopts updated application dates and withholds missing or foreign evidence", () => {
  const page = fixture("graspop");
  const parse = (html) => parseCampingGuidance(html, "graspop", 2027);
  const changed = parse(page.replace("31 May", "30 May"));
  assert.match(changed[0].description.en, /30 May 2027/);
  assert.match(changed[2].description.en, /River Stage and Hall/);
  assert.equal(parse(page.replace("31 May", "32 May")), undefined);
  assert.equal(parse(page.replace("16 June 2027", "16 June 2028")), undefined);
  assert.equal(parse(page.replace("THE INTER CAMPSITE", "A DIFFERENT CAMPSITE")), undefined);
  assert.equal(parse(page.replaceAll("<details", "<details hidden")), undefined);
});

test("alcatraz: both camping endpoints must be valid and ordered", () => {
  const page = fixture("alcatraz");
  for (const ending of ["Monday 2/8", "Sunday 9/8", "Monday 32/8", "Monday 9/13"]) {
    assert.equal(
      parseCampingGuidance(page.replace("Monday 9/8", ending), "alcatraz", 2027),
      undefined,
    );
  }
  const reversedHours = page.replace("Monday 9/8 (noon)", "Thursday 5/8 (8h)");
  assert.equal(parseCampingGuidance(reversedHours, "alcatraz", 2027), undefined);
});
