import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const html = readFileSync(
  new URL("./fixtures/official-markup/provinssi-excerpt.html", import.meta.url),
  "utf8",
);
const source = {
  festivalSlug: "provinssi",
  url: "https://www.provinssi.fi/en/",
  editionYear: 2027,
  strategies: ["official_markup"],
  enabled: true,
  refreshPolicy: "daily",
};
const parse = (h = html, s = {}) =>
  extractFestivalCandidate(h, { ...source, ...s }, "2026-11-17T11:00:00Z");
test("Provinssi official announcement has 19 unranked acts, dates and city", () => {
  const c = parse();
  assert.equal(c.lineup.length, 19);
  assert.ok(c.lineup.includes("Bullet For My Valentine"));
  assert.equal(c.headliners, undefined);
  assert.equal(c.startDate, "2027-07-01");
  assert.equal(c.endDate, "2027-07-03");
  assert.equal(c.city, "Seinäjoki");
  assert.deepEqual(c.warnings, []);
});
test("Provinssi rejects wrong edition, URL, truncated slider, missing name and foreign artist URL", () => {
  for (const [h, s] of [
    [html, { editionYear: 2028 }],
    [html, { url: "https://evil.test/" }],
    [html.replaceAll("2027", "2026"), {}],
    [html.replace("</section>", ""), {}],
    [html.replace(">JVG</h3>", "></h3>"), {}],
    [html.replaceAll("https://www.provinssi.fi/en/artists/", "https://evil.test/en/artists/"), {}],
    [html.replace("1.-3.7.2027", "32.-33.7.2027"), {}],
  ])
    assert.deepEqual(parse(h, s).evidence, []);
});
test(
  "Provinssi corroborated changed dates remain reviewable, addi" +
    "tive replay preserves billing and omitted acts",
  () => {
    const c = parse();
    const current = {
      slug: "provinssi",
      editionYear: 2027,
      startDate: c.startDate,
      endDate: c.endDate,
      city: c.city,
      status: "confirmed",
      headliners: [c.lineup[0]],
      lineup: [...c.lineup.slice(1), "Saved Artist"],
      ticketsUrl: c.ticketsUrl,
    };
    assert.deepEqual(evaluateCandidate(current, c).changes, []);
    const later = evaluateCandidate(current, parse(html.replace("1.-3.7.2027", "8.-10.7.2027")));
    assert.ok(later.reviewReasons.length > 0);
    assert.ok(!later.changes.some((c) => c.kind.endsWith("_removed")));
  },
);

test("Provinssi preserves the observed ticket href and accepts escaped ampersands in artist names", () => {
  const c = parse(html.replace(">JVG</h3>", ">Artist &amp; Artist</h3>"));
  assert.ok(c.lineup.includes("Artist & Artist"));
  assert.equal(c.ticketsUrl, "https://provinssi.fi/en/tickets-2027");
  assert.deepEqual(
    parse(
      html.replace(
        'href="https://provinssi.fi/en/tickets-2027"',
        'href="https://evil.test/tickets"',
      ),
    ).evidence,
    [],
  );
});

test("Provinssi decodes decimal and hexadecimal entities without publishing unknown or invalid entity text", () => {
  for (const entity of ["&amp;", "&#38;", "&#x26;", "&#X26;"])
    assert.ok(
      parse(html.replace(">JVG</h3>", `>Artist ${entity} Artist</h3>`)).lineup.includes(
        "Artist & Artist",
      ),
    );
  assert.ok(
    parse(html.replace(">JVG</h3>", ">Artist &#x1f3b8;</h3>")).lineup.includes("Artist 🎸"),
  );
  for (const entity of ["&#x110000;", "&#xD800;", "&#99999999;", "&unknown;"])
    assert.deepEqual(parse(html.replace(">JVG</h3>", `>Artist ${entity}</h3>`)).evidence, []);
});
test("Provinssi additive roster cannot enter admin replacement, including stale approvals", async () => {
  const { assertAdminArtistReviewAllowed } = await import("../lib/catalog/admin-artist-review.ts");
  const { publishAdminFestivalChange } = await import("../lib/catalog/publication.ts");
  for (const field of ["lineup", "headliners"]) {
    assert.throws(
      () => assertAdminArtistReviewAllowed("provinssi", [field]),
      /protected ingestion review/,
    );
    await assert.rejects(
      publishAdminFestivalChange(
        {},
        {
          change: {
            id: "stale-provinssi",
            resourceKey: "provinssi",
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
  assert.doesNotThrow(() => assertAdminArtistReviewAllowed("provinssi", ["startDate", "endDate"]));
});
