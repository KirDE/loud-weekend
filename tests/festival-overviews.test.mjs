import assert from "node:assert/strict";
import test from "node:test";
import { overviewSourceHost } from "../lib/catalog/festival-overviews.ts";

test("overview evidence must be a public HTTPS URL on the organizer host", () => {
  assert.equal(overviewSourceHost("https://www.organizer.example.test/stages"), "organizer.example.test");
  for (const url of [
    "not a URL", "http://organizer.example.test/stages",
    "https://credentials@organizer.example.test/stages", "https://organizer.example.test:8080/stages",
    "https://organizer.example.test/stages?token=secret", "https://organizer.example.test/stages#section",
  ]) {
    assert.equal(overviewSourceHost(url), undefined);
  }
});
