import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHtmlFallbackCandidate } from "../lib/ingestion/adapters/html-fallback.ts";
import { extractJsonLdCandidate } from "../lib/ingestion/adapters/json-ld.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const source = {
  festivalSlug: "fixture-fest",
  url: "https://fixture.test/",
  strategies: ["html_fallback"],
  refreshPolicy: "daily",
  enabled: true,
  editionYear: 2027,
};
const extracted = (markup) =>
  extractHtmlFallbackCandidate(
    `<meta property="event:start_time" content="2027-07-01">${markup}`,
    source,
    "2026-08-29T12:00:00Z",
  );

test("Hurricane and Southside navigation label is not an artist", () => {
  for (const label of ["Artists,", "Artyści"]) {
    const candidate = extracted(`<div class="lineup-artist">${label}</div>`);
    assert.deepEqual(candidate.lineup, []);
    assert.ok(candidate.warnings.some((warning) => warning.includes("navigation label")));
  }
});

test("Resurrection Fest date heading is not an artist", () => {
  const candidate = extracted('<div class="lineup-artist">LINEUP 1 - 4 JULIO 2026</div>');
  assert.deepEqual(candidate.lineup, []);
  assert.ok(candidate.warnings.some((warning) => warning.includes("schedule/date/stage")));
});

test("Rock en Seine schedule and combined containers require review", () => {
  const candidate = extracted(
    '<div class="lineup-artist">Mer 26 Août 22:00 / Grande Scène<' +
      '/div><div class="lineup-artist">Band A<br>Band B</div>',
  );
  assert.deepEqual(candidate.lineup, []);
  assert.ok(candidate.warnings.some((warning) => warning.includes("schedule/date/stage")));
  assert.ok(candidate.warnings.some((warning) => warning.includes("trusted adapter")));
});

test("Eurockéennes day/date suffix is removed from a canonical artist name", () => {
  const candidate = extracted(
    '<div class="lineup-artist">Queens of the Stone Age — Vendred' +
      'i 4 Juillet 2027</div><div class="lineup-artist">Ben Harper ' +
      "&amp; The Innocent Criminals dimanche 5 juillet</div>",
  );
  assert.deepEqual(candidate.lineup, [
    "Queens of the Stone Age",
    "Ben Harper & The Innocent Criminals",
  ]);
});

test("Summer Breeze countdown and nested headline block are not artists", () => {
  const candidate = extracted(
    '<div class="lineup-artist">12 DAYS LEFT</div><div class="lin' +
      'eup-artist"><span>Band A</span><br><span>Band B</span></div>',
  );
  assert.deepEqual(candidate.lineup, []);
  assert.equal(candidate.warnings.length, 2);
});

test("mismatched JSON-LD edition can never become publishable", () => {
  const jsonSource = { ...source, strategies: ["json_ld_event"] };
  const html =
    '<script type="application/ld+json">{"@type":"MusicEvent","st' +
    'artDate":"2026-08-26","performer":{"name":"Valid Band"}}</sc' +
    "ript>";
  const candidate = extractJsonLdCandidate(html, jsonSource, "2026-08-29T12:00:00Z");
  const current = {
    slug: "fixture-fest",
    name: "Fixture",
    country: "DE",
    city: "Berlin",
    startDate: "2027-07-01",
    endDate: "2027-07-03",
    officialUrl: source.url,
    status: "announced",
    headliners: [],
    lineup: [],
  };
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(
    result.reviewReasons.some((reason) => reason.includes("does not match catalogue edition")),
  );
});

const current = {
  slug: source.festivalSlug,
  name: "Fixture",
  country: "DE",
  city: "Berlin",
  editionYear: 2027,
  startDate: "2027-07-01",
  officialUrl: source.url,
  status: "announced",
  headliners: [],
  lineup: [],
  ticketsUrl: "https://fixture.test/previous-tickets",
};

for (const strategy of ["html_fallback", "json_ld_event"]) {
  const extractNames = (names) =>
    strategy === "html_fallback"
      ? extracted(
          names.map((name) => `<div class="lineup-artist">${name}</div>`).join("") +
            '<a href="/tickets">Tickets</a>',
        )
      : extractJsonLdCandidate(
          `<script type="application/ld+json">${JSON.stringify({
            "@type": "MusicEvent",
            startDate: current.startDate,
            performer: names.map((name) => ({ name })),
            offers: { url: "https://fixture.test/tickets" },
          })}</script>`,
          { ...source, strategies: [strategy] },
          "2026-08-29T12:00:00Z",
        );

  test(`${strategy} preserves both competing spellings for editorial review`, () => {
    for (const names of [
      ["Tora Vale", "Tóra Vale"],
      ["Tóra Vale", "Tora Vale"],
    ]) {
      const candidate = extractNames(names);
      const result = evaluateCandidate(current, candidate);
      assert.deepEqual(candidate.lineup, names);
      assert.ok(result.changes.some(({ kind }) => kind === "tickets_changed"));
      assert.ok(
        result.reviewReasons.some((reason) => reason.includes("Ambiguous lineup spellings")),
      );
      assert.equal(result.publishable, false);
    }
  });

  test(`${strategy} still deduplicates case and Unicode encoding of the same spelling`, () => {
    const candidate = extractNames(["Tóra Vale", "TÓRA VALE", "To\u0301ra Vale"]);
    assert.deepEqual(candidate.lineup, ["Tóra Vale"]);
    assert.deepEqual(candidate.warnings, []);
    assert.equal(evaluateCandidate(current, candidate).publishable, true);
  });
}
