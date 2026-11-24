import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  graspopRailSources,
  parseGraspopRailShuttle,
  parseGraspopArrival,
  parseWackenArrival,
} from "../lib/ingestion/adapters/arrival-guidance.ts";

const read = (name) =>
  readFileSync(new URL(`./fixtures/arrival/${name}.html`, import.meta.url), "utf8");
const essentials = read("graspop-essentials"),
  news = read("graspop-announcement"),
  wacken = read("wacken");

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
  assert.equal(
    parseGraspopArrival(essentials, news.replace("paid shuttle", "free shuttle"), 2027),
    undefined,
  );
});
test("Wacken requires the edition-specific vehicle, drop-off and route rules", () => {
  assert.equal(parseWackenArrival(wacken, 2027).kind, "camper");
  assert.equal(parseWackenArrival(wacken, 2028), undefined);
  assert.equal(
    parseWackenArrival(
      wacken.replace("ohne Access Pass ist nicht gestattet", "ist gestattet"),
      2027,
    ),
    undefined,
  );
  assert.equal(
    parseWackenArrival(wacken.replace("Routenkategorie", "Parkfläche"), 2027),
    undefined,
  );
});

test("rail shuttles require linked edition-specific proof in both directions", () => {
  const [, operatorUrl] = graspopRailSources("graspop");
  const organizer = read("graspop-rail-organizer");
  const timetable = read("graspop-rail-operator");
  const parse = (html, list = organizer) =>
    parseGraspopRailShuttle(list, html, 2027, {
      startDate: "2027-06-17",
      endDate: "2027-06-20",
    });
  const complete = parse(timetable);
  assert.match(complete.description.en, /Brussels-Midi, Eindhoven Centraal/);
  assert.equal(complete.supportingSourceUrl, operatorUrl);
  const reduced = parse(
    timetable.replace("Station Brussels South (Gare du Midi)", "Unverified station"),
  );
  assert.doesNotMatch(reduced.description.en, /Brussels-Midi/);
  assert.equal(parse(timetable.replace("21/06/2027", "21/06/2028")), undefined);
  assert.equal(parse(timetable.replace("21/06/2027", "20/06/2027")), undefined);
  assert.equal(parse(timetable.replace("21/06/2027", "14/06/2027")), undefined);
  assert.equal(parse(timetable.replace("16/06/2027", "23/06/2027")), undefined);
  assert.equal(parse(timetable.replace("16/06/2027", "09/06/2027")), undefined);
  assert.equal(parse(timetable.replace("21/06/2027", "28/06/2027")), undefined);
  assert.equal(
    parse(timetable, organizer.replace(operatorUrl, "https://elsewhere.example/")),
    undefined,
  );
  assert.equal(
    parse(
      timetable,
      organizer.replace("A separate ticket is required", "No separate ticket is required"),
    ),
    undefined,
  );
});
