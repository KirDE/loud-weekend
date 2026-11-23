import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const html = readFileSync(new URL("./fixtures/mystic-2027-home.html", import.meta.url), "utf8");
const source = {
  festivalSlug: "mystic",
  url: "https://www.mysticfestival.pl/",
  editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"],
  enabled: true,
  refreshPolicy: "every_3_days",
};
const parse = (document = html, overrides = {}) =>
  extractFestivalCandidate(document, { ...source, ...overrides }, "2026-10-10T15:00:00Z");
const current = {
  slug: "mystic",
  editionYear: 2027,
  headliners: ["Faith No More"],
  lineup: ["Lorna Shore", "Watain", "Converge", "Green Lung"],
  status: "partial",
  startDate: "2027-06-10",
  endDate: "2027-06-12",
  ticketsUrl: source.url,
  ticketStatus: "available",
};
const grid = readFileSync(
  new URL("./fixtures/mystic-2027-home-grid.html", import.meta.url),
  "utf8",
);
const saved = {
  ...current,
  lineup: [
    ...current.lineup,
    "Helloween",
    "Children of Bodom",
    "Cryptopsy",
    "Bodysnatcher",
    "Celestial Sanctuary",
    "Marilyn Manson",
  ],
};
test("real corrected Mystic case splits artist links, binds edition and preserves verified billing/gateway", () => {
  const c = parse();
  assert.deepEqual(c.headliners, current.headliners);
  assert.deepEqual(c.lineup, current.lineup);
  for (const k of ["startDate", "endDate", "status", "ticketStatus", "ticketsUrl"])
    assert.equal(c[k], current[k]);
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  const r = evaluateCandidate(current, c);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.reviewReasons, []);
});
test("later artist and explicit headliner announcements are data, not hardcoded bill/hash", () => {
  let later = html
    .replace(
      "</div>",
      '<a href="/artist/new-act/">New &amp; Act</a><a href="https://evil.test/artist/spam/">Spam</a></div>',
    )
    .replace("Faith No More pierwszym", "New &amp; Act kolejnym");
  const c = parse(later);
  assert.deepEqual(c.headliners, ["New & Act"]);
  assert.deepEqual(c.lineup, ["Faith No More", ...current.lineup]);
  assert.equal(c.status, "partial");
  assert.deepEqual(c.warnings, []);
});
test("artist container ignores duplicates, historical prose, scripts and comments", () => {
  const c = parse(
    html.replace("</div>", '<a href="/artist/green-lung/">Green Lung</a></div>') +
      ('<p>Gościliśmy Iron Maiden, Slayer</p><!--<div class="band_li' +
        'st"><a href="/artist/fake/">Fake</a></div>--><script>"<div c' +
        'lass="band_list"><a href="/artist/script/">Script</a></div>"' +
        "</script>"),
  );
  assert.deepEqual(c.lineup, current.lineup);
});
test("wrong/absent/ambiguous/invalid edition date cannot replace verified facts", () => {
  for (const text of [
    html.replaceAll("2027", "2026"),
    html.replace("10-12.06.2027", ""),
    html.replace("10-12.06.2027", "31-32.06.2027"),
    html + '<span class="elementor-heading-title">11-13.06.2027</span>',
  ]) {
    const c = parse(text);
    assert.equal(c.lineup, undefined);
    assert.equal(c.ticketsUrl, undefined);
    assert.ok(c.warnings.length);
  }
  assert.equal(parse(html, { editionYear: 2028 }).lineup, undefined);
});
test("missing billing does not demote a known headliner; no sale evidence means no availability guess", () => {
  const c = parse(html.replace("pierwszym headlinerem", "potwierdzony"));
  assert.equal(c.headliners, undefined);
  assert.equal(c.lineup, undefined);
  assert.ok(c.warnings.length);
  assert.equal(
    parse(html.replace("bilety Early Bird już w sprzedaży", "Do zobaczenia")).ticketStatus,
    undefined,
  );
  assert.equal(
    parse(html.replace("bilety Early Bird już w sprzedaży", "bilety wyprzedane")).ticketStatus,
    "sold_out",
  );
});
test("no unconfigured purchase host or non-home source is trusted", () => {
  assert.equal(
    parse(html.replace("https://tickets.mysticfestival.pl/pl/", "https://evil.test/")).ticketsUrl,
    undefined,
  );
  assert.equal(parse(html, { url: source.url + "history/" }).lineup, undefined);
});

test("only explicit current-edition full-bill wording upgrades completeness", () => {
  assert.equal(
    parse(html + '<h2 class="elementor-heading-title">Pełny skład Mystic Festival 2027</h2>')
      .status,
    "confirmed",
  );
  assert.equal(
    parse(html + '<h2 class="elementor-heading-title">Pełny skład Mystic Festival 2026</h2>')
      .status,
    "partial",
  );
});

test("real October 30 home grid is unranked and unchanged against all eleven saved artists", () => {
  const c = parse(grid);
  const r = evaluateCandidate(saved, c);
  assert.equal(c.lineup.length, 11);
  assert.equal(c.lineupScope, "announcement");
  assert.equal(c.headliners, undefined);
  assert.equal(c.status, undefined);
  assert.equal(c.ticketStatus, undefined);
  assert.deepEqual(new Set(c.lineup), new Set([...saved.headliners, ...saved.lineup]));
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.reviewReasons, []);
  assert.equal(r.publishable, false);
  // hp-headliners contains eight artist cards, not eight proven headliners.
  assert.ok(c.lineup.includes("Marilyn Manson"));
  assert.ok(c.lineup.includes("Helloween"));
});
test("later unranked additions require review, never removal, demotion or provider publication", () => {
  const later = grid.replace(
    '</div>\n<a href="https://tickets.',
    '<a href="/artist/future-act/">Future Act</a></div>\n<a href="https://tickets.',
  );
  const c = parse(later);
  const r = evaluateCandidate(saved, c);
  assert.ok(c.lineup.includes("Future Act"));
  assert.equal(c.headliners, undefined);
  assert.deepEqual(r.changes, [
    { kind: "artist_added", field: "lineup", after: "Future Act", reviewRequired: false },
  ]);
  assert.equal(r.publishable, false);
  assert.ok(r.reviewReasons.some((s) => s.includes("Mystic")));
  const confirmed = evaluateCandidate(
    { ...saved, status: "confirmed", lineup: [...saved.lineup, "Verified Later Act"] },
    parse(grid),
  );
  assert.deepEqual(confirmed.changes, []);
  assert.deepEqual(confirmed.reviewReasons, []);
});
test("unranked list fallback requires corroborating official cards and current edition", () => {
  for (const document of [
    grid.replaceAll("2027", "2026"),
    grid.replaceAll("pure-artists-list", "other-list"),
    grid.replaceAll("artist-inner", "other-card"),
    grid.replaceAll("<h6>", "<p>").replaceAll("</h6>", "</p>"),
    grid.replace("<h6>Faith No&nbsp;More</h6>", "<h6>Unlisted Card</h6>"),
    grid.replace(
      /href="https:\/\/www.mysticfestival.pl\/artist\//g,
      'href="https://evil.test/artist/',
    ),
  ]) {
    const c = parse(document);
    assert.equal(c.lineup, undefined);
    assert.ok(evaluateCandidate(saved, c).reviewReasons.length);
  }
});
test("quiet Mystic warning exception does not accept another source, edition or warning", () => {
  const c = parse(grid);
  for (const candidate of [
    { ...c, sourceUrl: "https://evil.test/" },
    { ...c, observedEditionYears: [2026] },
    { ...c, evidence: [] },
    { ...c, festivalSlug: "other" },
  ])
    assert.ok(evaluateCandidate(saved, candidate).reviewReasons.length);
  assert.deepEqual(
    evaluateCandidate(saved, { ...c, warnings: [...c.warnings, "Independent evidence conflict"] })
      .reviewReasons,
    ["Independent evidence conflict"],
  );
});

test("Mystic ticket stock ignores hidden, archived and non-content sellout claims", () => {
  const archived =
    '<span class="elementor-icon-box-title">Mystic Festival 2026 bilety wyprzedane</span>';
  const hidden =
    '<section hidden><span class="elementor-icon-box-title">bilety wyprzedane</span></section>';
  const footer = '<footer><span class="elementor-icon-box-title">bilety wyprzedane</span></footer>';
  for (const extra of [archived, hidden, footer]) {
    const c = parse(html + extra);
    assert.equal(c.ticketStatus, "available");
    assert.deepEqual(c.warnings, []);
  }
});

test("Mystic conflicting current stock statements retain the last verified state for review", () => {
  const c = parse(
    html + '<span class="elementor-icon-box-title">Mystic Festival 2027 bilety wyprzedane</span>',
  );
  assert.equal(c.ticketStatus, undefined);
  assert.ok(c.warnings.some((w) => w.includes("ticket banners conflict")));
  const result = evaluateCandidate(current, c);
  assert.equal(result.publishable, false);
  assert.ok(!result.changes.some((change) => change.field === "ticketStatus"));
});

test("Mystic disabled or credential-bearing ticket controls are not live offers", () => {
  for (const document of [
    html.replace(
      'class="elementor-button elementor-button-link elementor-size-sm"',
      'aria-disabled="true" class="elementor-button elementor-button-link elementor-size-sm"',
    ),
    html.replace(
      "https://tickets.mysticfestival.pl/pl/",
      "https://other@tickets.mysticfestival.pl/pl/",
    ),
    html.replace(
      "https://tickets.mysticfestival.pl/pl/",
      "https://tickets.mysticfestival.pl:8443/pl/",
    ),
  ]) {
    const c = parse(document);
    assert.equal(c.ticketStatus, undefined);
    assert.equal(c.ticketsUrl, undefined);
  }
});

test("Mystic hidden sale text and hidden current date do not establish current ticket inventory", () => {
  const hiddenSale =
    html.replace(
      "🐙  Faith No More pierwszym headlinerem &amp; bilety Early Bird już w sprzedaży!  🎉",
      "Faith No More pierwszym headlinerem",
    ) +
    '<section style="display:none"><span class="elementor-icon-box-title">bilety w sprzedaży</span></section>';
  assert.equal(parse(hiddenSale).ticketStatus, undefined);
  const hiddenDate = html.replace(
    'class="elementor-heading-title elementor-size-medium"',
    'hidden class="elementor-heading-title elementor-size-medium"',
  );
  const c = parse(hiddenDate);
  assert.equal(c.ticketStatus, undefined);
  assert.ok(c.warnings.some((w) => w.includes("visible current-edition date")));
  assert.equal(evaluateCandidate(current, c).publishable, false);
});
