import assert from "node:assert/strict";
import { test } from "node:test";
import { parserSource as getFestivalSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup =
  "\n  <title>Rock im Park | 4 - 6 Juni 2027 | Nürnberg</title>\n" +
  '  <article class="lineup-day">\n    <span class="headliner" a' +
  'ria-label="Headliner">\n      <span class="name artist-label ' +
  'al--logo"><a href="/line-up/headliner"><img title="Headliner' +
  ' One" alt="Logo Headliner One"></a></span>\n    </span>\n    <' +
  'span class="second" aria-label="Secondary">\n      <span clas' +
  's="name artist-label"><a href="/line-up/band-a"><span>Band A' +
  '</span></a></span>\n      <span class="name artist-label"><a ' +
  'href="/line-up/band-b"><span>Band &amp; B</span></a></span>\n' +
  '    </span>\n    <div class="special" aria-label="Very specia' +
  'l guests">\n      <span class="name artist-label al--logo"><a' +
  ' href="/line-up/special"><img alt="Logo Special Guest"></a><' +
  '/span>\n    </div>\n  </article>\n  <a href="/news/not-an-artis' +
  't">Not an artist</a>';

for (const slug of ["rock-am-ring", "rock-im-park"]) {
  test(`${slug} uses trusted schedule-aware lineup markup`, () => {
    const source = getFestivalSource(slug);
    const candidate = extractFestivalCandidate(markup, source, "2026-09-15T13:20:00Z");
    assert.equal(candidate.startDate, "2027-06-04");
    assert.equal(candidate.endDate, "2027-06-06");
    assert.deepEqual(candidate.observedEditionYears, [2027]);
    assert.deepEqual(candidate.headliners, ["Headliner One"]);
    assert.deepEqual(candidate.lineup, ["Band A", "Band & B", "Special Guest"]);
    assert.deepEqual(candidate.warnings, []);
    assert.deepEqual(
      candidate.evidence.map(({ field }) => field),
      ["startDate", "endDate", "headliners", "lineup"],
    );
  });
}

test("the adapter fails closed when the official artist links disappear", () => {
  const source = getFestivalSource("rock-im-park");
  const candidate = extractFestivalCandidate(
    "<title>Rock im Park | 4 - 6 Juni 2027 | Nürnberg</title>",
    source,
    "2026-09-15T13:20:00Z",
  );
  assert.deepEqual(candidate.evidence, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
});
