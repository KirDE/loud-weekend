import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJsonLdCandidate } from "../lib/ingestion/adapters/json-ld.ts";

const source = {
  festivalSlug: "example-fest",
  url: "https://festival.example/",
  strategies: ["json_ld_event"],
  refreshPolicy: "daily",
  enabled: true,
  editionYear: 2027,
};

test("JSON-LD extraction normalizes dates, city, performers, and tickets", () => {
  const html =
    '\n    <script type="application/ld+json">\n      {\n        "@c' +
    'ontext": "https://schema.org",\n        "@type": "MusicEvent"' +
    ',\n        "startDate": "2027-07-01T16:00:00+02:00",\n        ' +
    '"endDate": "2027-07-03",\n        "location": {"@type": "Plac' +
    'e", "address": {"addressLocality": "Berlin"}},\n        "perf' +
    'ormer": [{"@type": "MusicGroup", "name": "Band A"}, {"name":' +
    ' "Band B"}],\n        "offers": {"@type": "Offer", "url": "ht' +
    'tps://tickets.example/fest", "availability": "https://schema' +
    '.org/LimitedAvailability"},\n        "subEvent": [{"@type": "' +
    'MusicEvent", "name": "Band A", "startDate": "2027-07-01T18:3' +
    '0:00Z", "location": {"name": "Main Stage"}}]\n      }\n    </s' +
    "cript>";
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.endDate, "2027-07-03");
  assert.equal(candidate.city, "Berlin");
  assert.deepEqual(candidate.lineup, ["Band A", "Band B"]);
  assert.equal(candidate.ticketsUrl, "https://tickets.example/fest");
  assert.equal(candidate.ticketStatus, "low");
  assert.deepEqual(candidate.timetable, [
    { date: "2027-07-01", start: "18:30", stage: "Main Stage", artist: "Band A" },
  ]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(
    new Set(candidate.evidence.map(({ field }) => field)),
    new Set(["startDate", "endDate", "city", "lineup", "ticketsUrl", "ticketStatus", "timetable"]),
  );
});

test("JSON-LD extraction supports @graph and routes risky statuses to review", () => {
  const html = `<script type='application/ld+json'>${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Promoter" },
      {
        "@type": ["Event", "MusicEvent"],
        startDate: "2027-08-05",
        eventStatus: "https://schema.org/EventCancelled",
      },
    ],
  })}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-08-05");
  assert.ok(candidate.warnings.some((warning) => warning.includes("EventCancelled")));
});

test("missing or malformed JSON-LD returns a reviewable candidate", () => {
  const malformed = extractJsonLdCandidate(
    '<script type="application/ld+json">{broken}</script>',
    source,
    "2026-08-28T21:00:00.000Z",
  );
  assert.deepEqual(malformed.evidence, []);
  assert.deepEqual(malformed.warnings, ["No JSON-LD Event was found"]);
});

for (const [states, expected] of [
  [["SoldOut"], "sold_out"],
  [["OutOfStock"], "unavailable"],
  [["LimitedAvailability"], "low"],
  [["InStock", "SoldOut"], "available"],
  [["LimitedAvailability", "SoldOut"], "low"],
  [["SoldOut", null], undefined],
  [["NotSoldOut"], undefined],
  [["SoldOut", "OutOfStock"], "unavailable"],
])
  test(`JSON-LD ticket availability ${JSON.stringify(states)} remains ${expected}`, () => {
    const offers = states.map((state) => ({
      "@type": "Offer",
      url: "https://tickets.example/fest",
      ...(state ? { availability: `https://schema.org/${state}` } : {}),
    }));
    const html =
      '<script type="application/ld+json">' +
      JSON.stringify({
        "@type": "MusicEvent",
        name: "Example Fest",
        startDate: "2027-07-01",
        offers,
      }) +
      "</script>";
    const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
    assert.equal(candidate.ticketStatus, expected);
    if (expected)
      assert.ok(
        candidate.evidence.some((e) => e.field === "ticketStatus" && e.sourceUrl === source.url),
      );
  });

test("invalid or incomplete JSON-LD dates cannot establish an event edition", () => {
  for (const invalidDate of [
    "2027-02-29",
    "2027-13-01",
    "2027-01-01garbage",
    "2027-07-01T99:00:00Z",
    "2027-12-31T24:00:00Z",
    { name: "2027-07-01" },
    "2027",
  ]) {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "MusicEvent",
      startDate: invalidDate,
      endDate: "2027-07-03",
      offers: { availability: "https://schema.org/SoldOut" },
    })}</script>`;
    const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
    assert.equal(candidate.startDate, undefined, invalidDate);
    assert.deepEqual(candidate.observedEditionYears, [], invalidDate);
    assert.ok(
      candidate.warnings.includes("JSON-LD Event contains an invalid start date"),
      invalidDate,
    );
  }
});

test("a malformed same-year event does not outrank a dated event or make it ambiguous", () => {
  const html = `<script type="application/ld+json">${JSON.stringify([
    { "@type": "MusicEvent", startDate: "2027-02-29", offers: { availability: "SoldOut" } },
    {
      "@type": "MusicEvent",
      startDate: "2027-07-02T23:30:00-04:00",
      endDate: "2027-07-34",
      offers: { availability: "InStock" },
    },
  ])}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
  assert.equal(candidate.startDate, "2027-07-02");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.ticketStatus, "available");
  assert.equal(candidate.endDate, undefined);
  assert.deepEqual(candidate.warnings, ["JSON-LD Event contains an invalid end date"]);
});

test("a reversed event interval cannot prove the selected edition", () => {
  const reversed = {
    "@type": "MusicEvent",
    startDate: "2027-07-03",
    endDate: "2027-07-01",
    offers: { availability: "SoldOut" },
  };
  const wrap = (events) => `<script type="application/ld+json">${JSON.stringify(events)}</script>`;
  const date = "2026-11-17T00:00:00Z";
  const candidate = extractJsonLdCandidate(wrap([reversed]), source, date);
  assert.deepEqual(candidate.observedEditionYears, []);
  assert.equal(candidate.ticketStatus, undefined);
  assert.deepEqual(candidate.evidence, []);
  assert.ok(candidate.warnings.includes("JSON-LD Event end date precedes its start date"));

  const crossYear = {
    "@type": "MusicEvent",
    startDate: "2027-12-31",
    endDate: "2028-01-02",
    offers: { availability: "InStock" },
  };
  const valid = extractJsonLdCandidate(wrap([reversed, crossYear]), source, date);
  assert.deepEqual(valid.observedEditionYears, [2027]);
  assert.equal(valid.ticketStatus, "available");
  assert.equal(valid.endDate, "2028-01-02");
});

test("only actual JSON-LD script elements supply edition evidence", () => {
  const event = JSON.stringify({
    "@type": "MusicEvent",
    startDate: "2027-07-01",
    offers: { availability: "SoldOut" },
  });
  for (const html of [
    `<!-- <script type="application/ld+json">${event}</script> -->`,
    `<script data-type="application/ld+json">${event}</script>`,
    `<template><script type="application/ld+json">${event}</script></template>`,
  ]) {
    const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
    assert.deepEqual(candidate.observedEditionYears, []);
    assert.deepEqual(candidate.evidence, []);
    assert.equal(candidate.ticketStatus, undefined);
  }
});

test("edition evidence quotes the selected record, not another event in the same graph", () => {
  const html = `<script type = 'Application/LD+JSON'>${JSON.stringify({
    "@graph": [
      { "@type": "MusicEvent", startDate: "2026-07-01", name: "Archived edition" },
      { "@type": "MusicEvent", startDate: "2027-07-01", offers: { availability: "InStock" } },
    ],
  })}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.ticketStatus, "available");
  assert.ok(candidate.evidence.length > 0);
  for (const { excerpt } of candidate.evidence) {
    assert.match(excerpt, /2027-07-01/);
    assert.doesNotMatch(excerpt, /Archived edition/);
  }
});

test("only chronological offset-qualified event timestamps prove the edition", () => {
  const observed = "2026-11-17T00:00:00Z";
  const event = {
    "@type": "MusicEvent",
    startDate: "2027-07-03T18:00:00+02:00",
    offers: { availability: "SoldOut" },
  };
  const extract = (endDate) =>
    extractJsonLdCandidate(
      `<script type="application/ld+json">${JSON.stringify({ ...event, endDate })}</script>`,
      source,
      observed,
    );
  // The later wall-clock time is an earlier instant once the offsets are applied.
  const reversed = extract("2027-07-03T19:00:00+04:00");
  assert.deepEqual(reversed.observedEditionYears, []);
  assert.equal(reversed.ticketStatus, undefined);
  assert.deepEqual(reversed.evidence, []);
  assert.ok(reversed.warnings.includes("JSON-LD Event end date precedes its start date"));

  // Mixed precision has date-only semantics; two explicit offsets compare as instants.
  for (const endDate of ["2027-07-03", "2027-07-03T17:00:00Z"]) {
    const valid = extract(endDate);
    assert.deepEqual(valid.observedEditionYears, [2027]);
    assert.equal(valid.ticketStatus, "sold_out");
  }
});

const sideShow = {
  "@type": "MusicEvent",
  name: "Official afterparty",
  startDate: "2027-07-02",
  superEvent: { "@id": "https://festival.example/#edition" },
  offers: { url: "https://tickets.example/afterparty", availability: "InStock" },
  performer: { name: "Side Stage Act" },
};

test("a same-year child event cannot prove festival tickets or lineup", () => {
  const html = `<script type="application/ld+json">${JSON.stringify(sideShow)}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.deepEqual(candidate.observedEditionYears, []);
  assert.deepEqual(candidate.evidence, []);
  assert.equal(candidate.ticketsUrl, undefined);
  assert.equal(candidate.ticketStatus, undefined);
  assert.equal(candidate.lineup, undefined);
});

test("a child event listed first does not displace or invalidate its parent edition", () => {
  const edition = {
    "@id": "https://festival.example/#edition",
    "@type": "MusicEvent",
    name: "Example Fest",
    startDate: "2027-07-01",
    offers: { url: "https://tickets.example/fest", availability: "SoldOut" },
  };
  const graph = { "@graph": [sideShow, edition] };
  const html = `<script type="application/ld+json">${JSON.stringify(graph)}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.ticketsUrl, "https://tickets.example/fest");
  assert.equal(candidate.ticketStatus, "sold_out");
  assert.equal(candidate.lineup, undefined);
  assert.deepEqual(candidate.warnings, []);
});
