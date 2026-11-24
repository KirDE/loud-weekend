import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import {
  observeTicketSupplement,
  ticketSupplementUrl,
  TICKET_SUPPLEMENT,
} from "../lib/ingestion/ticket-supplements.ts";

const source = {
  festivalSlug: "wacken-open-air",
  url: "https://www.wacken.com/",
  editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"],
  refreshPolicy: "daily",
  enabled: true,
};
const url = ticketSupplementUrl(source);
const fixture = readFileSync(
  new URL("./fixtures/ticket-status/wacken-standard-pass.html", import.meta.url),
  "utf8",
);
const home = '<a href="/de/tickets-shop/ticket-uebersicht-2027/">Tickets</a>';
const current = {
  slug: source.festivalSlug,
  editionYear: 2027,
  status: "partial",
  ticketStatus: "unknown",
  headliners: [],
  lineup: [],
};
const at = "2026-11-17T22:46:00Z";

async function pipeline(html = fixture, primary = home) {
  const requested = [];
  const result = await fetchSource(source, {
    maxAttempts: 1,
    fetchImpl: async (target) => {
      requested.push(target);
      assert.ok([source.url, url].includes(target));
      return new Response(target === source.url ? primary : html, {
        headers: { "content-type": "text/html" },
      });
    },
  });
  assert.equal(result.attempts, 2);
  return {
    candidate: extractFestivalCandidate(await result.response.text(), source, at),
    requested,
  };
}

test("Wacken: official standard pass beats sold-out loyalty products and historical footer", async () => {
  const { candidate, requested } = await pipeline();
  assert.deepEqual(requested, [source.url, url]);
  assert.equal(candidate.ticketStatus, "available");
  assert.equal(candidate.ticketsUrl, url);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.warnings, []);
  assert.ok(
    candidate.evidence.some(
      (e) =>
        e.field === "ticketStatus" && e.sourceUrl === url && e.excerpt.includes("standard Louder"),
    ),
  );
  assert.equal(evaluateCandidate(current, candidate).publishable, true);
  assert.equal(
    evaluateCandidate({ ...current, ticketStatus: "available", ticketsUrl: url }, candidate).changes
      .length,
    0,
  );
});

test("Wacken: explicit standard-pass sellout can replace prior availability", async () => {
  const sold = fixture
    .replace("wt-card--image-1", "wt-card--image-1 wt-card--soldout")
    .replace("General Access", "Sold Out")
    .replace(/<a class="wt-card__btn"[^]*?<\/a>/, "");
  const { candidate } = await pipeline(sold);
  assert.equal(candidate.ticketStatus, "sold_out");
  assert.equal(
    evaluateCandidate({ ...current, ticketStatus: "available", ticketsUrl: url }, candidate)
      .changes[0].after,
    "sold_out",
  );
});

for (const [name, change] of [
  ["wrong edition", (html) => html.replaceAll("2027", "2026")],
  [
    "hidden standard card",
    (html) =>
      html.replace(
        'class="wt-card wt-card--image wt-card--image-1"',
        'hidden class="wt-card wt-card--image wt-card--image-1"',
      ),
  ],
  [
    "hidden ancestor",
    (html) =>
      html
        .replace(
          '<div class="wt-card wt-card--image wt-card--image-1">',
          '<section hidden><div class="wt-card wt-card--image wt-card--image-1">',
        )
        .replace("</div>", "</div></section>"),
  ],
  [
    "disabled purchase",
    (html) => html.replace('class="wt-card__btn"', 'aria-disabled="true" class="wt-card__btn"'),
  ],
  [
    "foreign purchase destination",
    (html) => html.replaceAll("ticketstore.wacken.com", "tickets.example.test"),
  ],
  [
    "ambiguous duplicate regular product",
    (html) =>
      html.replace(
        "</body>",
        html.match(/<div class="wt-card wt-card--image wt-card--image-1">[^]*?<\/div>/)[0] +
          "</body>",
      ),
  ],
  [
    "conflicting stock and buy evidence",
    (html) =>
      html
        .replace("wt-card--image-1", "wt-card--image-1 wt-card--soldout")
        .replace("General Access", "Sold Out"),
  ],
])
  test(`Wacken: ${name} retains the last verified snapshot and requires review`, async () => {
    const { candidate } = await pipeline(change(fixture));
    assert.equal(candidate.ticketStatus, undefined);
    assert.ok(candidate.warnings.some((w) => w.includes("requires review")));
    assert.equal(
      evaluateCandidate({ ...current, ticketStatus: "available", ticketsUrl: url }, candidate)
        .publishable,
      false,
    );
  });

test("transport failures, block responses and non-HTML are not successful empty checks", async () => {
  for (const status of [403, 404, 429, 503]) {
    const result = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) =>
        new Response(target === source.url ? home : "unavailable", {
          status: target === source.url ? 200 : status,
          headers: { "content-type": "text/html" },
        }),
    });
    assert.equal(result.response.status, status);
    assert.equal(result.attempts, 2);
  }
  await assert.rejects(
    fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (target) =>
        new Response(target === source.url ? home : "{}", {
          headers: { "content-type": target === source.url ? "text/html" : "application/json" },
        }),
    }),
    /non-HTML/,
  );
  assert.ok(
    observeTicketSupplement("<html><title>Just a moment</title></html>", source, url).warning,
  );
});

test("supplement registry does not override explicit/manual sources or accept foreign envelopes", () => {
  for (const extra of [
    { url: "https://evil.example/" },
    { fetchUrl: source.url },
    { followLinkPattern: "tickets" },
    { strategies: ["manual_review"] },
  ])
    assert.equal(ticketSupplementUrl({ ...source, ...extra }), undefined);
  const candidate = extractFestivalCandidate(
    JSON.stringify({
      kind: TICKET_SUPPLEMENT,
      body: home,
      ticket: { url: "https://evil.example/", html: fixture },
    }),
    source,
    at,
  );
  assert.equal(candidate.ticketStatus, undefined);
  assert.ok(candidate.warnings.length);
});

const download = { ...source, festivalSlug: "download", url: "https://downloadfestival.co.uk/" };
const downloadUrl = ticketSupplementUrl(download);
const downloadFixture = readFileSync(
  new URL("./fixtures/ticket-status/download-regular-admission.html", import.meta.url),
  "utf8",
);

test("Download: current regular admission is available despite sold-out campervan accessories", () => {
  const result = observeTicketSupplement(downloadFixture, download, downloadUrl);
  assert.equal(result.status, "available");
  assert.equal(result.warning, undefined);
});

for (const [name, change] of [
  ["archived header", (html) => html.replaceAll("2027", "2026")],
  [
    "hidden admission",
    (html) => html.replaceAll('class="ticket-card"', 'class="ticket-card" hidden'),
  ],
  ["disabled admission", (html) => html.replaceAll("<a href=", '<a aria-disabled="true" href=')],
  ["foreign seller", (html) => html.replaceAll("www.ticketmaster.co.uk", "tickets.example.test")],
  ["missing regular category", (html) => html.replace("Weekend Arena Only</h2>", "VIP Only</h2>")],
  ["schema drift", (html) => html.replace("5 Nights</p>", "4 Nights</p>")],
  [
    "all ordinary types sold out but other inventory unknown",
    (html) =>
      html
        .replaceAll(
          'class="ticket-card"',
          'class="ticket-card so"><span class="swash">Sold Out</span><span',
        )
        .replace(/<a [^]*?<\/a>/g, ""),
  ],
])
  test(`Download: ${name} does not fabricate availability or a global sellout`, () => {
    const result = observeTicketSupplement(change(downloadFixture), download, downloadUrl);
    assert.equal(result.status, undefined);
    assert.ok(result.warning);
  });

test(
  "successful supplement reconciles absent optional homepage fo" +
    "rmats, not edition or semantic warnings",
  async () => {
    const { candidate } = await pipeline(fixture, "<html><h1>Wacken news</h1></html>");
    assert.equal(candidate.ticketStatus, "available");
    assert.deepEqual(candidate.warnings, []);
    assert.equal(evaluateCandidate(current, candidate).publishable, true);
    const archived =
      '<script type="application/ld+json">' +
      JSON.stringify({
        "@type": "MusicEvent",
        name: "Wacken Open Air 2026",
        startDate: "2026-07-29",
        endDate: "2026-08-01",
      }) +
      "</script>";
    const stale = (await pipeline(fixture, archived)).candidate;
    assert.ok(stale.observedEditionYears.includes(2026));
    assert.equal(evaluateCandidate(current, stale).publishable, false);
    assert.ok(evaluateCandidate(current, stale).reviewReasons.length);
    const cancelled = archived
      .replaceAll("2026", "2027")
      .replace(
        '"@type":"MusicEvent"',
        '"@type":"MusicEvent","eventStatus":"https://schema.org/EventCancelled"',
      );
    const blocked = (await pipeline(fixture, cancelled)).candidate;
    assert.ok(blocked.warnings.some((w) => /cancel/i.test(w)));
    assert.equal(evaluateCandidate(current, blocked).publishable, false);
  },
);
