import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { ticketSupplementUrl, TICKET_SUPPLEMENT } from "../lib/ingestion/ticket-supplements.ts";

const source = {
  festivalSlug: "sweden-rock",
  url: "https://swedenrock.com/",
  editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"],
  refreshPolicy: "daily",
  enabled: true,
};
const ticketUrl = "https://swedenrock.com/biljetter";
const at = "2026-11-24T16:39:07Z";
const read = (name) =>
  readFileSync(new URL(`./fixtures/sweden-rock/${name}.html`, import.meta.url), "utf8");
const home = read("redesign-home");
const tickets = read("redesign-tickets");
const parse = (ticket = tickets, config = source) =>
  extractFestivalCandidate(
    JSON.stringify({
      kind: TICKET_SUPPLEMENT,
      body: home,
      ticket: { url: ticketUrl, html: ticket },
    }),
    config,
    at,
  );

test("redesigned official homepage uses the current ticket page without catalogue changes", async () => {
  const unsupported = extractFestivalCandidate(home, source, at);
  assert.ok(unsupported.warnings.includes("Sweden Rock current ticket summary was not found"));
  assert.equal(unsupported.ticketStatus, undefined);
  const requested = [];
  const fetched = await fetchSource(source, {
    maxAttempts: 1,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(url === source.url ? home : tickets, {
        headers: { "content-type": "text/html" },
      });
    },
  });
  assert.deepEqual(requested, [source.url, ticketUrl]);
  const c = extractFestivalCandidate(await fetched.response.text(), source, at);
  assert.equal(c.ticketStatus, "available");
  assert.equal(c.ticketsUrl, ticketUrl);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.ok(c.evidence.every((e) => e.sourceUrl === ticketUrl));
  const current = {
    slug: source.festivalSlug,
    editionYear: 2027,
    startDate: "2027-06-09",
    endDate: "2027-06-12",
    ticketStatus: "available",
    ticketsUrl: ticketUrl,
    lineup: ["Existing artist"],
    headliners: [],
    status: "partial",
  };
  const result = evaluateCandidate(current, c);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.reviewReasons, []);
  assert.equal(c.lineup, undefined);
  assert.equal(c.startDate, undefined);
});

test("later editions, sold-out ordinary passes and Blind Bird-only evidence remain distinct", () => {
  assert.equal(
    parse(tickets.replaceAll("2027", "2028"), { ...source, editionYear: 2028 }).ticketStatus,
    "available",
  );
  for (const html of [
    tickets.replaceAll("2027", "2026"),
    tickets.replace("ute nu på Ticketmaster", "information kommer"),
    tickets.replace("ute nu på Ticketmaster", "information kommer") +
      "<h2>Merch</h2><p>Biljetter ute nu på Ticketmaster</p>",
  ]) {
    const c = parse(html);
    assert.equal(c.ticketStatus, undefined);
    assert.ok(c.warnings.length);
  }
  assert.equal(
    parse(tickets.replace("ute nu på Ticketmaster", "Festivalpass är slutsålda")).ticketStatus,
    "sold_out",
  );
});

test("supplement requires exact reviewed source configuration and final destination", async () => {
  for (const config of [
    { ...source, url: "https://foreign.test/" },
    { ...source, url: source.url + "archive" },
    { ...source, url: source.url + "?year=2026" },
    { ...source, fetchUrl: ticketUrl },
    { ...source, followLinkPattern: "tickets" },
    { ...source, strategies: ["manual_review"] },
  ])
    assert.equal(ticketSupplementUrl(config), undefined);
  for (const finalUrl of ["https://foreign.test/", ticketUrl + "/archive"]) {
    await assert.rejects(
      fetchSource(source, {
        maxAttempts: 1,
        fetchImpl: async (url) => {
          const r = new Response(url === source.url ? home : tickets, {
            headers: { "content-type": "text/html" },
          });
          Object.defineProperty(r, "url", { value: url === source.url ? source.url : finalUrl });
          return r;
        },
      }),
      /identity/,
    );
  }
});
