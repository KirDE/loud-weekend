import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseGraspopArrival, parseWackenArrival } from "../lib/ingestion/adapters/arrival-guidance.ts";

const read = name => readFileSync(new URL(`./fixtures/arrival/${name}.html`, import.meta.url), "utf8");
const essentials = read("graspop-essentials"), news = read("graspop-announcement"), wacken = read("wacken");

test("Graspop observations reflect changes to the organizer venue and shuttle destinations", () => {
  const result = parseGraspopArrival(
    essentials.replace("Festival Park Stenehei", "North Festival Park"),
    news.replace("Eindhoven Airport", "Antwerp Airport"),
    2027,
  );
  assert.match(result[0].description.en, /North Festival Park/);
  assert.match(result[1].description.en, /Antwerp Airport/);
  assert.doesNotMatch(result[1].description.en, /Eindhoven/);
});
test("Graspop withholds stale, hidden and unconfirmed shuttle evidence", () => {
  assert.equal(parseGraspopArrival(essentials.replace("2027", "2026"), news, 2027), undefined);
  assert.equal(parseGraspopArrival(essentials, news.replace("<p>", "<p hidden>"), 2027), undefined);
  assert.equal(parseGraspopArrival(essentials, news.replace("paid shuttle", "free shuttle"), 2027), undefined);
});
test("Wacken requires the edition-specific vehicle, drop-off and route rules", () => {
  assert.equal(parseWackenArrival(wacken, 2027).kind, "camper");
  assert.equal(parseWackenArrival(wacken, 2028), undefined);
  assert.equal(parseWackenArrival(wacken.replace("ohne Access Pass ist nicht gestattet", "ist gestattet"), 2027), undefined);
  assert.equal(parseWackenArrival(wacken.replace("Routenkategorie", "Parkfläche"), 2027), undefined);
});
