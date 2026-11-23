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
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "MusicEvent",
        "startDate": "2027-07-01T16:00:00+02:00",
        "endDate": "2027-07-03",
        "location": {"@type": "Place", "address": {"addressLocality": "Berlin"}},
        "performer": [{"@type": "MusicGroup", "name": "Band A"}, {"name": "Band B"}],
        "offers": {"@type": "Offer", "url": "https://tickets.example/fest", "availability": "https://schema.org/LimitedAvailability"},
        "subEvent": [{"@type": "MusicEvent", "name": "Band A", "startDate": "2027-07-01T18:30:00Z", "location": {"name": "Main Stage"}}]
      }
    </script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.endDate, "2027-07-03");
  assert.equal(candidate.city, "Berlin");
  assert.deepEqual(candidate.lineup, ["Band A", "Band B"]);
  assert.equal(candidate.ticketsUrl, "https://tickets.example/fest");
  assert.equal(candidate.ticketStatus, "low");
  assert.deepEqual(candidate.timetable, [{ date: "2027-07-01", start: "18:30", stage: "Main Stage", artist: "Band A" }]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(new Set(candidate.evidence.map(({ field }) => field)), new Set(["startDate", "endDate", "city", "lineup", "ticketsUrl", "ticketStatus", "timetable"]));
});

test("JSON-LD extraction supports @graph and routes risky statuses to review", () => {
  const html = `<script type='application/ld+json'>${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Promoter" },
      { "@type": ["Event", "MusicEvent"], startDate: "2027-08-05", eventStatus: "https://schema.org/EventCancelled" },
    ],
  })}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-08-05");
  assert.ok(candidate.warnings.some((warning) => warning.includes("EventCancelled")));
});

test("missing or malformed JSON-LD returns a reviewable candidate", () => {
  const malformed = extractJsonLdCandidate('<script type="application/ld+json">{broken}</script>', source, "2026-08-28T21:00:00.000Z");
  assert.deepEqual(malformed.evidence, []);
  assert.deepEqual(malformed.warnings, ["No JSON-LD Event was found"]);
});

for (const [states, expected] of [
  [["SoldOut"], "sold_out"], [["OutOfStock"], "unavailable"], [["LimitedAvailability"], "low"],
  [["InStock", "SoldOut"], "available"], [["LimitedAvailability", "SoldOut"], "low"],
  [["SoldOut", null], undefined], [["NotSoldOut"], undefined], [["SoldOut", "OutOfStock"], "unavailable"],
]) test(`JSON-LD ticket availability ${JSON.stringify(states)} remains ${expected}`, () => {
  const offers = states.map(state => ({ "@type": "Offer", url: "https://tickets.example/fest", ...(state ? { availability: `https://schema.org/${state}` } : {}) }));
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicEvent", name: "Example Fest", startDate: "2027-07-01", offers })}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
  assert.equal(candidate.ticketStatus, expected);
  if (expected) assert.ok(candidate.evidence.some(e => e.field === "ticketStatus" && e.sourceUrl === source.url));
});

test("invalid or incomplete JSON-LD dates cannot establish an event edition", () => {
  for (const invalidDate of ["2027-02-29", "2027-13-01", "2027-01-01garbage", "2027-07-01T99:00:00Z", "2027"]) {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "MusicEvent", startDate: invalidDate, endDate: "2027-07-03",
      offers: { availability: "https://schema.org/SoldOut" },
    })}</script>`;
    const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
    assert.equal(candidate.startDate, undefined, invalidDate);
    assert.deepEqual(candidate.observedEditionYears, [], invalidDate);
    assert.ok(candidate.warnings.includes("JSON-LD Event contains an invalid start date"), invalidDate);
  }
});

test("a malformed same-year event does not outrank a dated event or make it ambiguous", () => {
  const html = `<script type="application/ld+json">${JSON.stringify([
    { "@type": "MusicEvent", startDate: "2027-02-29", offers: { availability: "SoldOut" } },
    { "@type": "MusicEvent", startDate: "2027-07-02T23:30:00-04:00", endDate: "2027-07-34", offers: { availability: "InStock" } },
  ])}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-11-17T00:00:00Z");
  assert.equal(candidate.startDate, "2027-07-02");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.ticketStatus, "available");
  assert.equal(candidate.endDate, undefined);
  assert.deepEqual(candidate.warnings, ["JSON-LD Event contains an invalid end date"]);
});

test("a reversed event interval cannot prove the selected edition", () => {
  const reversed = { "@type": "MusicEvent", startDate: "2027-07-03", endDate: "2027-07-01",
    offers: { availability: "SoldOut" } };
  const wrap = events => `<script type="application/ld+json">${JSON.stringify(events)}</script>`;
  const date = "2026-11-17T00:00:00Z";
  const candidate = extractJsonLdCandidate(wrap([reversed]), source, date);
  assert.deepEqual(candidate.observedEditionYears, []);
  assert.equal(candidate.ticketStatus, undefined);
  assert.deepEqual(candidate.evidence, []);
  assert.ok(candidate.warnings.includes("JSON-LD Event end date precedes its start date"));

  const crossYear = { "@type": "MusicEvent", startDate: "2027-12-31", endDate: "2028-01-02",
    offers: { availability: "InStock" } };
  const valid = extractJsonLdCandidate(wrap([reversed, crossYear]), source, date);
  assert.deepEqual(valid.observedEditionYears, [2027]);
  assert.equal(valid.ticketStatus, "available");
  assert.equal(valid.endDate, "2028-01-02");
});
