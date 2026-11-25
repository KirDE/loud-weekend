import assert from "node:assert/strict";
import test from "node:test";
import { overviewSourceHost } from "../lib/catalog/festival-overviews.ts";

test("overview evidence must be a public HTTPS URL on the organizer host", () => {
  assert.equal(
    overviewSourceHost("https://www.organizer.example.test/stages"),
    "organizer.example.test",
  );
  for (const url of [
    "not a URL",
    "http://organizer.example.test/stages",
    "https://credentials@organizer.example.test/stages",
    "https://organizer.example.test:8080/stages",
    "https://organizer.example.test/stages?token=secret",
    "https://organizer.example.test/stages#section",
  ]) {
    assert.equal(overviewSourceHost(url), undefined);
  }
});

import { parseFestivalOverview } from "../lib/ingestion/adapters/festival-overview.ts";

test("Alcatraz overview lists only visible stage names on the current edition page", () => {
  const page = `<title>Stages | Alcatraz 2027</title><h1>Stages</h1>
    <div class="card-body"><h5>River Stage</h5></div>
    <div class="card-body" hidden><h5>Hidden Stage</h5></div>`;
  assert.match(parseFestivalOverview(page, "alcatraz", 2027).en, /River Stage\.$/);
  assert.equal(parseFestivalOverview(page, "alcatraz", 2028), undefined);
  assert.equal(parseFestivalOverview(page.replace("River Stage", ""), "alcatraz", 2027), undefined);
});

test("Wacken event terms must explicitly list the named location and stage scope", () => {
  const page = `<title>AGB 2027 - Event | Wacken Open Air</title>
    <p>1.3 Veranstaltungsgelände: Die Veranstaltung findet auf dem ausgewiesenen Festivalgelände statt.
    Dazu gehört insbesondere die Eventfläche der Gemeinde Wacken.
    Hierzu gehören auch das Gelände vor den Haupt- und Nebenbühnen.</p>`;
  assert.match(parseFestivalOverview(page, "wacken-open-air", 2027).en, /main and side stage/);
  assert.equal(
    parseFestivalOverview(page.replace("Haupt- und Nebenbühnen", "Zelte"), "wacken-open-air", 2027),
    undefined,
  );
});
