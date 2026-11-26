import { summerStockResponse } from "./support/summer-stock-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const html = readFileSync(
  new URL("./fixtures/official-markup/summer-punch-full.html", import.meta.url),
  "utf8",
);
const source = {
  festivalSlug: "summer-punch",
  url: "https://summerpunchfestival.pl/",
  editionYear: 2027,
  strategies: ["official_markup"],
  enabled: true,
  refreshPolicy: "daily",
};
const parse = (h = html, s = {}) =>
  extractFestivalCandidate(h, { ...source, ...s }, "2026-11-20T15:59:00Z");
const c = parse();
const current = {
  slug: "summer-punch",
  editionYear: 2027,
  city: c.city,
  startDate: c.startDate,
  endDate: c.endDate,
  status: "partial",
  ticketStatus: "unknown",
  ticketsUrl: c.ticketsUrl,
  headliners: [c.lineup[0]],
  lineup: [...c.lineup.slice(1), "Previously Announced Artist"],
};
test("real complete official response yields 16 text-linked unranked artists and current dates", () => {
  assert.equal(c.lineup.length, 16);
  assert.equal(c.startDate, "2027-06-17");
  assert.equal(c.endDate, "2027-06-19");
  assert.equal(c.city, "Warszawa");
  assert.ok(c.lineup.includes("Body Count ft. Ice-T"));
  assert.ok(c.lineup.includes("Karen Dió"));
  assert.equal(c.headliners, undefined);
  assert.equal(c.status, "partial");
  assert.deepEqual(c.warnings, []);
});
test(
  "reject wrong edition, URL, malformed dates, conflicting date" +
    " headings, incomplete hero and untrusted artist link",
  () => {
    for (const [h, s] of [
      [html, { editionYear: 2028 }],
      [html, { url: "https://evil.test/" }],
      [html.replaceAll("2027", "2026"), {}],
      [html.replace("Festival, 17-19 czerwca", "Festival, 17-20 czerwca"), {}],
      [html.replaceAll("17-19", "31-33"), {}],
      [html.replaceAll("</section>", ""), {}],
      [html.replace('href="/lineup/mgk"', 'href="https://evil.test/lineup/mgk"'), {}],
      [html.replace('href="/lineup/mgk"', 'href="/lineup/mgk?year=2026"'), {}],
      [html.replace("hero-shell__section", "archive-section"), {}],
    ]) {
      assert.equal(parse(h, s).lineup, undefined);
      assert.ok(parse(h, s).warnings.length);
    }
  },
);
test("partial or malformed linked lineup cannot silently lose an artist", () => {
  for (const h of [
    html.replace('href="/lineup/mgk"', 'href="/archive/mgk"'),
    html.replace('aria-label="mgk, THU 17.06"', 'aria-label="mgk, THU 24.06"'),
    html.replace(">Beartooth</a>", "></a>"),
    html.replace('href="/lineup/currents"', 'href="/lineup/beartooth"'),
  ])
    assert.equal(parse(h).lineup, undefined);
});
test("known additive replay preserves headliners and missing saved artists without another review", () => {
  const r = evaluateCandidate(current, c);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.reviewReasons, []);
  assert.equal(r.publishable, false);
});
test("later current-edition artist is extracted dynamically and requires protected review", () => {
  const h = html
    .replace("Wystąpią: mgk,", "Wystąpią: New Artist, mgk,")
    .replace(
      '<div class="hero-lineup-stage',
      '<a href="/lineup/new-artist">New Artist</a><div class="hero-lineup-stage',
    );
  const r = evaluateCandidate(current, parse(h));
  assert.ok(r.candidate.lineup.includes("New Artist"));
  assert.ok(
    r.changes.some(
      (d) => d.kind === "artist_added" && d.after === "New Artist" && d.reviewRequired,
    ),
  );
  assert.ok(r.reviewReasons.length);
  assert.ok(!r.changes.some((d) => d.kind.endsWith("_removed")));
});
test("future corroborated edition works, changed date is reviewed, scripts and biography do not name artists", () => {
  assert.equal(
    parse(
      html
        .replaceAll("2027", "2028")
        .replaceAll("THU 17.06", "SAT 17.06")
        .replaceAll("FRI 18.06", "SUN 18.06"),
      { editionYear: 2028 },
    ).lineup.length,
    16,
  );
  const changed = parse(html.replaceAll("17-19", "18-20").replaceAll("THU 17.06", "FRI 18.06"));
  assert.equal(changed.startDate, "2027-06-18");
  assert.ok(evaluateCandidate(current, changed).reviewReasons.length);
  assert.deepEqual(
    parse(
      html + '<script><a href="/lineup/fake">Fake</a></script><p>Biography with Guest Artist</p>',
    ).lineup,
    c.lineup,
  );
});

test("stale artist weekdays fail after edition advances and legitimate ampersands are accepted", () => {
  assert.equal(parse(html.replaceAll("2027", "2028"), { editionYear: 2028 }).lineup, undefined);
  assert.ok(
    parse(html.replaceAll("Beartooth", "Artist &amp; Artist")).lineup.includes("Artist & Artist"),
  );
  assert.equal(parse(html.replaceAll("Beartooth", "Artist &unknown; Artist")).lineup, undefined);
});
test("Summer Punch additive roster cannot be replaced by the admin path, including stale approval", async () => {
  const { assertAdminArtistReviewAllowed } = await import("../lib/catalog/admin-artist-review.ts");
  const { publishAdminFestivalChange } = await import("../lib/catalog/publication.ts");
  for (const field of ["lineup", "headliners"]) {
    assert.throws(
      () => assertAdminArtistReviewAllowed("summer-punch", [field]),
      /protected ingestion review/,
    );
    await assert.rejects(
      publishAdminFestivalChange(
        {},
        {
          change: {
            id: "stale-summer-punch",
            resourceKey: "summer-punch",
            field,
            beforeValue: ["Saved Artist"],
            afterValue: ["New Artist"],
            sourceEvidence: [],
            parserRunId: "run",
          },
          actorLabel: "test",
        },
      ),
      /protected ingestion review/,
    );
  }
  assert.doesNotThrow(() => assertAdminArtistReviewAllowed("summer-punch", ["startDate"]));
});
test("fetch rejects foreign/same-origin redirects, missing response identity and acquisition overrides", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-22T14:08:00Z") });
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  const reply = (url) => {
    const r = new Response(html, { status: 200 });
    if (url) Object.defineProperty(r, "url", { value: url });
    return r;
  };
  for (const url of ["https://evil.test/", "https://summerpunchfestival.pl/archive", ""])
    await assert.rejects(
      fetchSource(source, { fetchImpl: async () => reply(url), maxAttempts: 1 }),
      /trusted identity/,
    );
  for (const extra of [{ fetchUrl: "https://evil.test/" }, { followLinkPattern: ".*" }])
    await assert.rejects(
      fetchSource(
        { ...source, ...extra },
        { fetchImpl: async () => reply(source.url), maxAttempts: 1 },
      ),
      /trusted identity/,
    );
  const accepted = await fetchSource(source, {
    fetchImpl: async (url) => summerStockResponse(url) ?? reply(source.url),
    maxAttempts: 1,
  });
  assert.equal(accepted.response.url, source.url);
  const failure = new Response("", { status: 503 });
  const result = await fetchSource(source, { fetchImpl: async () => failure, maxAttempts: 1 });
  assert.equal(result.response.status, 503);
});
