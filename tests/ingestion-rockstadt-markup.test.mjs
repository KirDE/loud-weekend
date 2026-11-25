import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";
import { parserSource } from "./support/parser-source.ts";

const url = "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/";
const at = "2026-10-07T00:00:00Z";
const source = (overrides = {}) => parserSource("rockstadt", { url, ...overrides });
const extract = (html, overrides) => extractFestivalCandidate(html, source(overrides), at);
const fixture = await readFile(
  new URL("./fixtures/official-markup/rockstadt-announcement-2027.html", import.meta.url),
  "utf8",
);
const artists = [
  "Slash featuring Myles Kennedy and The Conspirators",
  "Overkill",
  "Mgla",
  "Venom",
  "Jinjer",
  "Towards the Sinister",
];
const current = {
  slug: "rockstadt",
  name: "Rockstadt Extreme Fest",
  editionYear: 2027,
  country: "RO",
  officialUrl: "https://rockstadtextremefest.ro/",
  status: "announced",
  headliners: [],
  lineup: [],
};
const announcement = `First confirmed names: <strong>${artists.join(", ")}</strong>`;
const desc = fixture.match(/<div class="event-short-desc">[\s\S]*?<\/div>/)[0];
const updatedDescription = (
  await readFile(
    new URL("./fixtures/official-markup/rockstadt-first-wave-20261028.html", import.meta.url),
    "utf8",
  )
).match(/<div class="event-short-desc">[\s\S]*?<\/div>/)[0];
const updatedArtists = [
  "Lake of Tears",
  ...artists,
  "Therion",
  "Six Feet Under",
  "Embryonic Autopsy",
  "Triptykon",
];

function noEvidence(html, overrides) {
  const candidate = extract(html, overrides);
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.observedEditionYears, []);
  for (const field of ["startDate", "endDate", "city", "lineup", "headliners", "status"])
    assert.equal(candidate[field], undefined);
  const result = evaluateCandidate({ ...current, lineup: artists }, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.publishable, false);
  assert.match(candidate.warnings.join("; "), /found no trustworthy fields/);
}

test("exact ticket article extracts only the six first names, dates, city and 2027 review evidence", () => {
  assert.equal(sourceParserKey(source()), "official_markup:rockstadt");
  const candidate = extract(fixture);
  assert.equal(candidate.startDate, "2027-07-26");
  assert.equal(candidate.endDate, "2027-07-30");
  assert.equal(candidate.city, "Ghimbav (Brașov)");
  assert.deepEqual(candidate.lineup, artists);
  assert.equal(candidate.headliners, undefined);
  assert.equal(candidate.status, "partial");
  assert.equal(candidate.artistListMode, "additive");
  assert.equal(candidate.ticketStatus, "available");
  assert.equal(candidate.ticketsUrl, url);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(
    candidate.evidence.map(({ field }) => field),
    ["startDate", "endDate", "city", "lineup", "status", "ticketStatus", "ticketsUrl"],
  );
  assert.ok(
    candidate.evidence.every(
      (item) =>
        item.sourceUrl === url &&
        item.observedAt === at &&
        item.excerpt.includes(announcement.replace(/<\/?strong>/g, "")),
    ),
  );
  assert.deepEqual(candidate.warnings, [
    "Agent review required before lineup-triggered provider activity",
  ]);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes(candidate.warnings[0]));
  assert.deepEqual(
    result.changes.filter(({ kind }) => kind === "artist_added").map(({ after }) => after),
    artists,
  );
});

test("manual_review homepage and ticket configurations stay inert until separately converted", () => {
  for (const sourceUrl of [current.officialUrl, url]) {
    const candidate = extract(fixture, {
      url: sourceUrl,
      strategies: ["manual_review"],
      manualReviewReason: "Official homepage requires review",
    });
    assert.deepEqual(candidate.evidence, []);
    assert.deepEqual(candidate.observedEditionYears, []);
    assert.equal(candidate.lineup, undefined);
    assert.match(candidate.warnings[0], /^Manual review only:/);
    assert.deepEqual(evaluateCandidate(current, candidate).changes, []);
    assert.equal(evaluateCandidate(current, candidate).publishable, false);
  }
});

test("only the exact source URL and edition 2027 are eligible", () => {
  for (const sourceUrl of [
    current.officialUrl,
    "https://bilete.rockstadtextremefest.ro/",
    url.slice(0, -1),
    url + "?year=2026",
    url + "#details",
    url.replace("2027-129242", "2026-123456"),
    url.replace("https:", "http:"),
    url.replace("bilete.rockstadtextremefest.ro", "evil.example"),
  ])
    noEvidence(fixture, { url: sourceUrl });
  for (const editionYear of [2026, 2028, undefined]) noEvidence(fixture, { editionYear });
});

test("OG article identity is unique, mandatory and internally consistent", () => {
  for (const property of ["og:url", "og:type", "og:title"]) {
    const tag = fixture.match(new RegExp(`<meta property="${property}"[^>]*>`))[0];
    noEvidence(fixture.replace(tag, ""));
    noEvidence(fixture.replace(tag, tag + tag));
  }
  for (const [before, after] of [
    [`content="${url}"`, `content="${current.officialUrl}"`],
    ['content="article"', 'content="website"'],
    ['content="Rockstadt Fest 2027"', 'content="Rockstadt Fest 2026"'],
    ["26-30 iul &#039;27", "26-30 iul &#039;26"],
    ["26-30 iul &#039;27", "27-30 iul &#039;27"],
  ])
    noEvidence(fixture.replace(before, after));
  const og = fixture.match(/<meta property="og:url"[^>]*>/)[0];
  noEvidence(fixture.replace(og, "").replace("</body>", og + "</body>")); // footer metadata cannot supply identity
  noEvidence(fixture.replace(og, `<script type="application/ld+json">${og}</script>`));
  noEvidence(fixture.replace("Bilete Rockstadt Fest 2027", "Bilete Rockstadt Fest 2026"));
  noEvidence(
    fixture.replace("</head>", `<link rel="canonical" href="${current.officialUrl}"></head>`),
  );
  assert.deepEqual(
    extract(fixture.replace("</head>", `<link rel="canonical" href="${url}"></head>`)).lineup,
    artists,
  );
});

test(
  "optional event metadata corroborates the id, name, dates and" +
    " venue; malformed or duplicate metadata fails",
  () => {
    const metadata = fixture.match(/<script>[\s\S]*?<\/script>/)[0];
    // OG alone is a sufficient identity anchor
    assert.deepEqual(extract(fixture.replace(metadata, "")).lineup, artists);
    for (const [before, after] of [
      ['"id":"129242"', '"id":"129241"'],
      ['"title":"Rockstadt Fest 2027"', '"title":"Rockstadt Fest 2026"'],
      ['"start_date":"2027-07-26"', '"start_date":"2026-07-26"'],
      ['"end_date":"2027-07-30"', '"end_date":"2027-07-31"'],
      ['"name":"Rockstadt Fest"', '"name":"Another event"'],
      ["Ghimbav (Bra\\u0219ov)", "Râșnov"],
      ['{"pageData":', '{"pageData":BROKEN'],
    ])
      noEvidence(fixture.replace(before, after));
    noEvidence(fixture.replace(metadata, metadata + metadata));
  },
);

test("old edition, wrong heading, dates and location fail closed", () => {
  noEvidence(
    fixture.replaceAll("2027", "2026").replaceAll("'27", "'26").replaceAll("&#039;27", "&#039;26"),
  );
  for (const [before, after] of [
    ["<h1>Rockstadt Fest 2027</h1>", "<h1>Rockstadt Fest 2026</h1>"],
    ["26-30 iulie '27", "26-30 iulie '26"],
    ["26-30 iulie '27", "25-30 iulie '27"],
    ["26-30 iulie '27", "26-31 iulie '27"],
    ["26-30 iulie '27", "26-30 august '27"],
    [
      "<strong>Rockstadt Fest, Ghimbav (Brașov)</strong>",
      "<strong>Rockstadt Fest, Râșnov</strong>",
    ],
    ["Starting with the 2027 edition", "Starting with the 2026 edition"],
  ])
    noEvidence(fixture.replace(before, after));
});

test("dynamic first-wave names are extracted without hardcoded identities or removals", () => {
  for (const names of [
    artists.slice(0, -1),
    [...artists, "Extra Artist"],
    ["Mgła", "Venom Inc.", "Slash"],
    ["Future Artist", "Another Artist"],
  ]) {
    const candidate = extract(fixture.replace(artists.join(", "), names.join(", ")));
    assert.deepEqual(candidate.lineup, names);
    assert.equal(candidate.status, "partial");
    const result = evaluateCandidate({ ...current, lineup: artists }, candidate);
    assert.equal(
      result.changes.some((change) => change.kind === "artist_removed"),
      false,
    );
    if (names.some((name) => !artists.includes(name))) assert.equal(result.publishable, false);
  }
  assert.deepEqual(
    extract(fixture.replace("A new name. The same heartbeat.", "More names to come this autumn."))
      .lineup,
    artists,
  );
});

test("2026-10-28 live mixed-case Strong announcement extracts all eleven names and retains review", () => {
  const candidate = extract(fixture.replace(desc, updatedDescription));
  assert.deepEqual(candidate.lineup, updatedArtists);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.status, "partial");
  assert.equal(candidate.ticketStatus, "available");
  const result = evaluateCandidate(
    {
      ...current,
      lineup: artists,
      city: "Ghimbav (Brașov)",
      startDate: "2027-07-26",
      endDate: "2027-07-30",
      status: "partial",
      ticketStatus: "available",
      ticketsUrl: url,
    },
    candidate,
  );
  assert.equal(result.publishable, false);
  assert.deepEqual(result.reviewReasons, [
    "Agent review required before lineup-triggered provider activity",
  ]);
  assert.deepEqual(
    result.changes.map((change) => [change.kind, change.after]),
    updatedArtists.filter((name) => !artists.includes(name)).map((name) => ["artist_added", name]),
  );
});

test("HTML emphasis casing and later names do not relax ambiguity, edition or cancellation guards", () => {
  for (const [open, close] of [
    ["STRONG", "STRONG"],
    ["sTrOnG", "StRoNg"],
    ["strong", "strong"],
  ]) {
    const description = updatedDescription
      .replace("<Strong>", `<${open}>`)
      .replace("</strong>", `</${close}>`);
    const html = fixture.replace(desc, description);
    assert.deepEqual(extract(html).lineup, updatedArtists);
    assert.deepEqual(extract(html.replace("Triptykon", "Triptykon, Future Act")).lineup, [
      ...updatedArtists,
      "Future Act",
    ]);
    noEvidence(html.replace("Triptykon", "Triptykon, OVERKILL"));
    noEvidence(
      html.replace(
        "First confirmed names:",
        "First confirmed names: <em>Extra Act</em><br>first confirmed names:",
      ),
    );
    noEvidence(html.replace("One community.", "Jinjer cancelled. One community."));
    noEvidence(html.replace("Starting with the 2027 edition", "Starting with the 2026 edition"));
  }
});

test("ambiguous, duplicate or malformed announcements fail closed", () => {
  for (const replacement of [
    artists.join(", ") + ", Overkill",
    "",
    ", Overkill",
    "1234",
    artists.join(", ").replace("Venom", "<em>Venom</em>"),
  ])
    noEvidence(fixture.replace(artists.join(", "), replacement));
  noEvidence(fixture.replace(announcement, announcement + "<br>" + announcement));
  noEvidence(fixture.replace(desc, desc + desc));
  noEvidence(fixture.replace(announcement, announcement + "<br>Also confirmed: Extra Artist"));
  noEvidence(fixture.replace(announcement, announcement + "<br>Jinjer cancelled"));
});

test("navigation, JSON-LD, footer and unrelated event boxes cannot supply or expand evidence", () => {
  const decoys =
    "<nav><h1>Rockstadt Fest 2026</h1>" +
    `${desc}` +
    '</nav><script type="application/ld+json">{"@type":"Event","n' +
    'ame":"Rockstadt 2026","performer":["Extra Artist"]}</script>' +
    "<footer>Extra Artist</footer>";
  assert.deepEqual(extract(fixture.replace("<body>", "<body>" + decoys)).lineup, artists);
  for (const wrapper of ["nav", "footer", 'script type="application/ld+json"']) {
    const closing = wrapper.split(" ")[0];
    noEvidence(
      fixture.replace(desc, "").replace("</body>", `<${wrapper}>${desc}</${closing}></body>`),
    );
  }
  noEvidence(fixture.replace('id="details"', 'id="archive"'));
  noEvidence(fixture.replace('class="event-short-desc"', 'class="navigation-desc"'));
  noEvidence(
    fixture.replace('<div class="date-location">', '<div></div><div class="date-location">'),
  );
  noEvidence(
    fixture.replace(desc, "").replace("</body>", `<div id="details">${desc}</div></body>`),
  );
  noEvidence(
    fixture
      .replace("<h1>Rockstadt Fest 2027</h1>", "")
      .replace("</body>", "<nav><h1>Rockstadt Fest 2027</h1></nav></body>"),
  );
});

test("empty, truncated and malformed documents cannot borrow closing tags or propose removals", () => {
  for (const html of [
    "",
    fixture.slice(0, fixture.indexOf(announcement)),
    fixture.slice(0, fixture.indexOf("Towards the Sinister") + 10),
    fixture.slice(0, fixture.indexOf("</body>")),
    fixture.replace("</strong>\n<br>", "\n<br>"),
    fixture.replace("<h1>", "<h2>"),
    fixture.replace('class="event-short-desc">', 'class="event-short-desc"'),
    fixture.replace("<br><br>", "<br><broken>"),
    fixture.replace("</div></div></div></div></section>", "</div></section>"),
  ])
    noEvidence(html);
  noEvidence(fixture.replace("</body>", "</div></body>"));
  noEvidence(fixture.replace("</body>", "<div></body>"));
  noEvidence(
    fixture.replace(
      '<div class="read-more" data-read-more="container">',
      '<div class="read-more" data-read-more="container" />',
    ),
  );
});

test("real public booking anchors prove sales; disabled, off-host, merch and stale prices do not", () => {
  for (const [before, after] of [
    ['class="order-form-widget can-book"', 'class="order-form-widget"'],
    ['data-disable-submit="0"', 'data-disable-submit="1"'],
    ['data-max-nr-tickets="20"', 'data-max-nr-tickets="0"'],
    ['data-is-ticket-nr="1"', 'data-is-ticket-nr="1" disabled="disabled"'],
    ['data-is-order-form-submit="true"', 'data-is-order-form-submit="true" disabled'],
    [
      'data-tariff-name="Abonament - Acces General"',
      'data-tariff-name="Transport and Merchandise"',
    ],
    ['data-tariff-sell-price="848.4"', 'data-tariff-sell-price="0"'],
    [
      'action="https://bilete.rockstadtextremefest.ro/widgetOrderForm/bookEvent/"',
      'action="https://evil.example/book/"',
    ],
    [`data-return-url="${url}"`, 'data-return-url="https://bilete.rockstadtextremefest.ro/2026/"'],
  ]) {
    const candidate = extract(fixture.replace(before, after));
    assert.deepEqual(candidate.lineup, artists);
    assert.equal(candidate.ticketStatus, undefined);
    assert.equal(candidate.ticketsUrl, undefined);
  }
  const noForm = fixture.replace(/<form\b[\s\S]*?<\/form>/, "");
  assert.equal(
    extract(
      noForm.replace(
        "</head>",
        '<script type="application/ld+json">{"offers":{"availability":"InStock","price":800}}</script></head>',
      ),
    ).ticketStatus,
    undefined,
  );
  assert.equal(
    extract(fixture.replace('data-tariff-sell-price="848.4"', 'data-tariff-sell-price="950"'))
      .ticketStatus,
    "available",
  );
});

test("corrected checks are quiet, preserve later lineup and billing, while new names still need review", () => {
  const corrected = {
    ...current,
    city: "Ghimbav (Brașov)",
    startDate: "2027-07-26",
    endDate: "2027-07-30",
    status: "partial",
    ticketsUrl: url,
    ticketStatus: "available",
    lineup: [...artists, "Later Reviewed Act"],
  };
  const unchanged = evaluateCandidate(corrected, extract(fixture));
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.reviewReasons, []);
  const billing = evaluateCandidate(
    { ...corrected, headliners: [artists[0]], lineup: corrected.lineup.slice(1) },
    extract(fixture),
  );
  assert.deepEqual(billing.changes, []);
  assert.deepEqual(billing.reviewReasons, []);
  const added = evaluateCandidate(
    corrected,
    extract(fixture.replace(artists.join(", "), [...artists, "Future Act"].join(", "))),
  );
  assert.equal(added.publishable, false);
  assert.ok(
    added.reviewReasons.includes("Agent review required before lineup-triggered provider activity"),
  );
  assert.deepEqual(
    added.changes.map((change) => [change.kind, change.after]),
    [["artist_added", "Future Act"]],
  );
  const complete = evaluateCandidate({ ...corrected, status: "confirmed" }, extract(fixture));
  assert.deepEqual(complete.changes, []);
  assert.equal(complete.candidate.status, "confirmed");
  const semantic = extract(fixture);
  semantic.warnings.push("Independent provenance conflict");
  assert.deepEqual(evaluateCandidate(corrected, semantic).reviewReasons, [
    "Independent provenance conflict",
  ]);
  const wrongEdition = evaluateCandidate({ ...corrected, editionYear: 2026 }, extract(fixture));
  assert.equal(wrongEdition.publishable, false);
  assert.ok(wrongEdition.reviewReasons.length);
});

test("hidden, ARIA-disabled and restricted admission cannot reopen ordinary ticket availability", () => {
  for (const [before, after] of [
    ['class="order-form-widget can-book"', 'hidden class="order-form-widget can-book"'],
    [
      'class="order-form-widget can-book"',
      'aria-disabled="true" class="order-form-widget can-book"',
    ],
    [
      'class="order-form-widget can-book"',
      'style="display:none" class="order-form-widget can-book"',
    ],
    ['data-is-order-form="true"', 'aria-disabled="true" data-is-order-form="true"'],
    ['data-is-order-form-submit="true"', 'aria-disabled="true" data-is-order-form-submit="true"'],
    ['data-is-ticket-nr="1"', 'hidden data-is-ticket-nr="1"'],
    [
      'data-tariff-name="Abonament - Acces General"',
      'data-tariff-name="TEENS Full Access - restricted age"',
    ],
    ['data-max-nr-tickets="20"', 'data-max-nr-tickets="Infinity"'],
    ['data-max-nr-tickets="20"', 'data-max-nr-tickets="0.5"'],
  ]) {
    const c = extract(fixture.replace(before, after));
    assert.equal(c.ticketStatus, undefined);
    assert.deepEqual(c.lineup, artists);
    assert(c.warnings.some((w) => w.includes("ordinary admission inventory requires review")));
    const saved = { ...current, lineup: artists, ticketStatus: "available", ticketsUrl: url };
    assert.equal(evaluateCandidate(saved, c).publishable, false);
    assert(!evaluateCandidate(saved, c).changes.some((change) => change.field === "ticketStatus"));
  }
});
test("a matching quantity outside the ordinary tariff cannot supply inventory proof", () => {
  const original = fixture.match(/<input data-tariff-id="351669"[^>]*>/)[0];
  const h = fixture.replace(original, "").replace("</form>", original + "</form>");
  const c = extract(h);
  assert.equal(c.ticketStatus, undefined);
  assert(c.warnings.some((w) => w.includes("inventory requires review")));
});

test("a visibly disabled checkout button cannot establish Rockstadt stock", () => {
  const page = fixture.replace(
    'data-is-order-form-submit="true"',
    'data-is-order-form-submit="true" class="disabled"',
  );
  const candidate = extract(page);
  assert.equal(candidate.ticketStatus, undefined);
  assert.deepEqual(candidate.lineup, artists);
  assert.ok(candidate.warnings.some((warning) => warning.includes("inventory requires review")));
});

// The live first-wave label is an album anniversary performance, not a new band.
const anniversaryLabel = "Venom -Black Metal (45th anniversary)";
function performanceArticle(label, artist = "Venom") {
  return fixture
    .replace(announcement, announcement.replace("Venom", label))
    .replace(
      '<div id="details"',
      `<h3 class="event-artist-heading"><a class="event-artist-link">${artist}</a></h3>` +
        '<div id="details"',
    );
}

test("corroborated album anniversary labels retain the existing artist identity", () => {
  for (const label of [anniversaryLabel, "Venom – Black Metal (50th anniversary)"]) {
    const candidate = extract(performanceArticle(label));
    assert.deepEqual(candidate.lineup, artists);
    const result = evaluateCandidate({ ...current, lineup: artists }, candidate);
    assert.deepEqual(
      result.changes.filter(({ kind }) => kind === "artist_added"),
      [],
    );
  }
});

test("anniversary normalization requires a matching article artist and explicit album suffix", () => {
  for (const [label, card] of [
    [anniversaryLabel, "Other Band"],
    ["Venom -Black Metal", "Venom"],
    ["Venom Inc.", "Venom"],
    ["Venom featuring Guest", "Venom"],
    ["Venom - Guest Band (20th anniversary)", "Venom"],
    ["Guest Band - Black Metal (20th anniversary)", "Guest Band"],
  ]) {
    const candidate = extract(performanceArticle(label, card));
    assert.ok(candidate.lineup.includes(label));
  }
  const later = performanceArticle(anniversaryLabel).replace(
    "Towards the Sinister</strong>",
    "Towards the Sinister, New Band</strong>",
  );
  assert.ok(extract(later).lineup.includes("New Band"));
});

test("hidden and duplicate artist cards cannot corroborate a performance label", () => {
  for (const attribute of ["hidden", 'aria-hidden="true"', 'style="display:none"']) {
    const hidden = performanceArticle(anniversaryLabel).replace(
      '<h3 class="event-artist-heading">',
      `<h3 ${attribute} class="event-artist-heading">`,
    );
    assert.ok(extract(hidden).lineup.includes(anniversaryLabel));
  }
  const doubled = performanceArticle(anniversaryLabel).replace(
    '<h3 class="event-artist-heading">',
    '<h3 class="event-artist-heading"><a class="event-artist-link">Venom</a></h3>' +
      '<h3 class="event-artist-heading">',
  );
  assert.ok(extract(doubled).lineup.includes(anniversaryLabel));
  const duplicate = performanceArticle(anniversaryLabel).replace(
    "Towards the Sinister</strong>",
    "Towards the Sinister, Venom</strong>",
  );
  noEvidence(duplicate);
});
