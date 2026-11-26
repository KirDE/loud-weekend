import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBrutalAssaultVenue } from "../lib/ingestion/adapters/brutal-assault-venue.ts";

const page = readFileSync(
  new URL("./fixtures/brutal-assault/about-venue.html", import.meta.url),
  "utf8",
);
test("the venue parser reads changing place and coordinates from the edition block", () => {
  const original = parseBrutalAssaultVenue(page, 2027);
  assert.equal(original.name, "Josefov Fortress");
  assert.equal(original.latitude, 50 + 20 / 60 + 25.54 / 3600);
  const changed = parseBrutalAssaultVenue(
    page.replace("Josefov Fortress", "New venue").replace("25.54", "26.54"),
    2027,
  );
  assert.equal(changed.name, "New venue");
  assert.equal(changed.latitude, 50 + 20 / 60 + 26.54 / 3600);
});
for (const [label, html] of [
  ["old edition", page.replace("2027", "2026")],
  ["absent coordinates", page.replace("GPS location", "Other location")],
  ["invalid coordinates", page.replace("25.54", "62")],
  ["hidden place", page.replace("<nav ", "<nav hidden ")],
  ["ambiguous places", page + page],
])
  test(`the venue parser withholds ${label}`, () =>
    assert.equal(parseBrutalAssaultVenue(html, 2027), undefined));
