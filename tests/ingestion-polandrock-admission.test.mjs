import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import {
  extractPolandrockAdmission,
  POLANDROCK_NEWSROOM,
} from "../lib/ingestion/adapters/polandrock-admission.ts";
const html = await readFile(
  new URL("./fixtures/official-markup/polandrock-admission.html", import.meta.url),
  "utf8",
);
const source = {
  festivalSlug: "polandrock",
  url: POLANDROCK_NEWSROOM,
  strategies: ["html_fallback"],
  editionYear: 2027,
  refreshPolicy: "daily",
  enabled: true,
};
const at = "2026-11-22T15:20:00Z";
const parse = (h = html, s = source) => extractFestivalCandidate(h, s, at);
const current = {
  slug: "polandrock",
  editionYear: 2027,
  startDate: "2027-07-29",
  endDate: "2027-07-31",
  ticketStatus: "unknown",
  status: "partial",
  lineup: ["Existing Artist"],
  headliners: [],
};
test("newsroom binds ordinary unticketed policy to the upcoming edition only", () => {
  const c = parse(html + '<a href="https://shop.example.test/camping">Buy VIP camping</a>');
  assert.equal(c.ticketStatus, "free");
  assert.equal(c.startDate, current.startDate);
  assert.equal(c.endDate, current.endDate);
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  for (const field of ["lineup", "headliners", "ticketsUrl", "status"])
    assert.equal(c[field], undefined);
  assert.ok(c.evidence.every((e) => e.sourceUrl === source.url && e.observedAt === at));
  const r = evaluateCandidate(current, c);
  assert.equal(r.publishable, true);
  assert.deepEqual(
    r.changes.map((c) => c.field),
    ["ticketStatus"],
  );
  assert.deepEqual(evaluateCandidate({ ...current, ticketStatus: "free" }, c).changes, []);
});
for (const [name, mutate] of Object.entries({
  archive: (h) => h.replace("odbędzie się", "odbył się"),
  stale: (h) => h.replace("2027 roku", "2026 roku"),
  invalid: (h) => h.replace("29-31.07", "29-32.07"),
  reverse: (h) => h.replace("29-31.07", "31-29.07"),
  missing: (h) => h.replace("darmowy i niebiletowany", "muzyczny"),
  children: (h) =>
    h.replace(
      "Festiwal jest darmowy i niebiletowany.",
      "Dzieci mają wstęp darmowy i niebiletowany.",
    ),
  paid: (h) => h.replace("</div>", "<p>Festiwal jest biletowany.</p></div>"),
  hidden: (h) => h.replace('class="pr-boiler-plate ', 'hidden class="pr-boiler-plate '),
  css: (h) => h.replace('class="pr-boiler-plate ', 'style="display:none" class="pr-boiler-plate '),
  script: (h) => `<script>${h}</script>`,
  template: (h) => `<template>${h}</template>`,
  duplicate: (h) => h + h,
  schema: (h) => h.replace("pr-boiler-plate ", "unrecognized "),
  conflict: (h) =>
    h.replace(
      "</div>",
      "<p>34. Pol'and'Rock Festival odbędzie się w dniach 27-29.07 2028 roku.</p></div>",
    ),
}))
  test(`unverified ${name} retains last-good admission`, () => {
    const c = parse(mutate(html));
    assert.equal(c.ticketStatus, undefined);
    assert.ok(c.warnings.length);
    assert.equal(evaluateCandidate(current, c).publishable, false);
  });
test("exact source registration only; future editions are not hard-coded", () => {
  for (const change of [
    { festivalSlug: "other" },
    { url: "https://foreign.test/" },
    { url: source.url + "other" },
    { fetchUrl: "https://foreign.test/" },
    { followLinkPattern: ".*" },
  ])
    assert.equal(extractPolandrockAdmission(html, { ...source, ...change }, at), undefined);
  const c = parse(html.replace("33.", "34.").replace("2027 roku", "2028 roku"), {
    ...source,
    editionYear: 2028,
  });
  assert.equal(c.ticketStatus, "free");
  assert.deepEqual(c.observedEditionYears, [2028]);
});
test("one independent GET, failed responses remain errors, identity redirects are rejected", async () => {
  for (const status of [200, 403, 429, 500]) {
    const calls = [];
    const r = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (u) => {
        calls.push(u);
        return new Response(status === 200 ? html : "error", { status });
      },
    });
    assert.deepEqual(calls, [source.url]);
    assert.equal(r.response.status, status);
    assert.equal(r.attempts, 1);
    if (status === 200) assert.equal(parse(await r.response.text()).ticketStatus, "free");
  }
  await assert.rejects(
    fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async () => {
        const r = new Response(html);
        Object.defineProperty(r, "url", { value: "https://foreign.test/" });
        return r;
      },
    }),
    /official identity/,
  );
});
