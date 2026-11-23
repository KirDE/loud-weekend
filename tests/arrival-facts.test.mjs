import assert from "node:assert/strict";
import test from "node:test";
import { arrivalSourceHost } from "../lib/catalog/arrival-facts.ts";

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
