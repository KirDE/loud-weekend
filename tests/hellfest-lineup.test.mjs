import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { parserSource } from "./support/parser-source.ts";
const html = readFileSync(
  new URL("./fixtures/official-markup/hellfest-homepage-2027.html", import.meta.url),
  "utf8",
);
const source = parserSource("hellfest", {
  url: "https://hellfest.fr/",
  strategies: ["json_ld_event", "html_fallback"],
});
const parse = (doc = html, config = source) =>
  extractFestivalCandidate(doc, config, "2026-11-26T21:00:00Z");
test("real homepage extracts individual text and logo identities rather than long containers", () => {
  const c = parse();
  assert.equal(c.lineup.length, 87);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.lineup.includes("MÖTLEY CRÜE"));
  assert.ok(c.lineup.includes("BLUE ÖYSTER CULT"));
  assert.ok(c.lineup.includes("BODY COUNT FEAT ICE-T"));
  assert.ok(c.lineup.includes("FAITH NO MORE"));
  assert.equal(c.headliners, undefined);
  assert.equal(c.ticketStatus, undefined);
  assert.equal(c.status, "partial");
  assert.equal(c.artistListMode, "additive");
  assert.equal(c.lineupScope, "announcement");
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.equal(c.evidence[0].adapter, "hellfest-homepage-v1");
});
test("later additions are supported, duplicate cards deduplicated, archived payload titles excluded", () => {
  const next =
    '<a class="home__bands-artist-name" href="/en/artist/new-band"><span>New Band &amp; Friends</span></a>';
  const c = parse(html.replace("</section>", next + next + "</section>"));
  assert.equal(c.lineup.length, 88);
  assert.ok(c.lineup.includes("New Band & Friends"));
  assert.deepEqual(c.warnings, []);
});
test("edition marker is mandatory and old homepage cannot populate current edition", () => {
  for (const doc of [
    html.replace("June 2027", "June 2026"),
    html.replace('id="hellbangers-date"', 'id="archived-date"'),
  ]) {
    const c = parse(doc);
    assert.equal(c.lineup, undefined);
    assert.ok(c.warnings.length);
  }
});
test("wrong host/path/source is not recognized as trusted Hellfest homepage", () => {
  for (const url of [
    "https://evil.test/",
    "https://hellfest.fr/en/news/archive",
    "https://hellfest.fr/?archive=1",
  ])
    assert.ok(
      !parse(html, { ...source, url }).evidence.some((e) => e.adapter === "hellfest-homepage-v1"),
    );
});
test("unsafe links, missing logo identity, contradictory hydration fail closed", () => {
  for (const doc of [
    html.replace("/en/artist/gojira", "https://evil.test/en/artist/gojira"),
    html.replace('"GOJIRA"', '""'),
    html.replace('"GOJIRA"', '"Wrong Band"').replace('"gojira"', '"other-band"'),
  ]) {
    const c = parse(doc);
    assert.equal(c.lineup, undefined);
    assert.ok(c.warnings.length);
  }
});
test("missing cards fails closed instead of pretending source is quiet", () => {
  const c = parse(html.replaceAll('class="home__bands-artist-', 'class="archive-'));
  assert.equal(c.lineup, undefined);
  assert.ok(c.warnings.length);
});

test("new Hellfest artists require protected review; unchanged and partial replays preserve billing", () => {
  const c = parse();
  const current = {
    slug: "hellfest",
    editionYear: 2027,
    name: "Hellfest",
    city: "Clisson",
    startDate: "2027-06-17",
    endDate: "2027-06-20",
    status: "partial",
    ticketStatus: "unknown",
    headliners: [],
    lineup: [],
  };
  const fresh = evaluateCandidate(current, c);
  assert.equal(fresh.publishable, false);
  assert.ok(
    fresh.reviewReasons.includes("Agent review required before lineup-triggered provider activity"),
  );
  const accepted = {
    ...current,
    headliners: ["GOJIRA"],
    lineup: c.lineup.filter((n) => n !== "GOJIRA"),
  };
  const same = evaluateCandidate(accepted, c);
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.reviewReasons, []);
  const partial = evaluateCandidate(accepted, { ...c, lineup: ["GOJIRA", "FAITH NO MORE"] });
  assert.deepEqual(partial.changes, []);
  assert.deepEqual(partial.reviewReasons, []);
  const later = evaluateCandidate(accepted, { ...c, lineup: [...c.lineup, "Future Act"] });
  assert.equal(later.publishable, false);
  assert.ok(later.reviewReasons.length);
  assert.equal(later.changes.filter((x) => x.kind === "artist_added").length, 1);
});

const french = readFileSync(
  new URL("./fixtures/official-markup/hellfest-homepage-fr-2027.html", import.meta.url),
  "utf8",
);
test("current French homepage /artiste cards retain all literal text and logo identities", () => {
  const c = parse(french);
  assert.equal(c.lineup.length, 87);
  assert.deepEqual(new Set(c.lineup), new Set(parse().lineup));
  assert.deepEqual(c.warnings, []);
  assert.equal(c.artistListMode, "additive");
  assert.equal(c.headliners, undefined);
  assert.equal(c.ticketStatus, undefined);
  const next = '<a class="home__bands-artist-name" href="/artiste/future-act">Future Act</a>';
  assert.equal(
    parse(french.replace('<a href="/artiste/gojira"', next + '<a href="/artiste/gojira"')).lineup
      .length,
    88,
  );
  for (const doc of [
    french.replaceAll("2027", "2026"),
    french.replace("/artiste/gojira", "https://evil.test/artiste/gojira"),
    french.replace("/artiste/gojira", "/news/gojira"),
  ]) {
    assert.equal(parse(doc).lineup, undefined);
    assert.ok(parse(doc).warnings.length);
  }
});

test("registered collector requests French only for exact trusted negotiating homepage", async () => {
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  const { hellfestHomepageHeaders } = await import("../lib/ingestion/adapters/hellfest-lineup.ts");
  for (const config of [
    { ...source, festivalSlug: "other" },
    { ...source, url: "https://evil.test/" },
    { ...source, url: "https://hellfest.fr/en" },
    { ...source, url: "https://hellfest.fr/?archive=1" },
    { ...source, fetchUrl: "https://hellfest.fr/en" },
    { ...source, followLinkPattern: "lineup" },
  ])
    assert.deepEqual(hellfestHomepageHeaders(config), {});
  let calls = 0;
  const result = await fetchSource(source, {
    maxAttempts: 1,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, source.url);
      assert.equal(init.headers["accept-language"], "fr-FR,fr;q=0.9");
      const r = new Response(french, { headers: { "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: source.url });
      return r;
    },
  });
  assert.equal(calls, 1);
  const c = parse(await result.response.text());
  assert.equal(c.lineup.length, 87);
  assert.deepEqual(c.warnings, []);
});
