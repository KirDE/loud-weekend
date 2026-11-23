import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHellfestOfferProposals } from "../lib/ingestion/adapters/hellfest-offers.ts";
const html = readFileSync(new URL("./fixtures/hellfest/offer-cards.html", import.meta.url), "utf8");
const input = {
  html,
  finalUrl: "https://hellfest.fr/",
  status: 200,
  editionYear: 2027,
  observedAt: "2026-11-22T15:30:00.000Z",
};
const parse = (changes = {}) => extractHellfestOfferProposals({ ...input, ...changes });
const rejected = (changes) => {
  const result = parse(changes);
  assert.deepEqual(result.offers, []);
  assert.ok(result.warnings.length);
};
test("separates sold-out full pass and future day pass, preserves unknown fees/date precision", () => {
  const r = parse();
  assert.deepEqual(r.warnings, []);
  assert.equal(r.offers.length, 2);
  assert.equal(r.offers[0].kind, "full_pass");
  assert.equal(r.offers[0].status, "sold_out");
  assert.deepEqual(r.offers[0].price, { amountMinor: 38900, currency: "EUR", fees: "unknown" });
  assert.equal(r.offers[0].saleDateText, "7 juillet - 13h");
  assert.equal(r.offers[1].kind, "day_pass");
  assert.equal(r.offers[1].status, "not_on_sale");
  assert.equal(r.offers[1].price, null);
  assert.equal(r.offers[1].saleDateText, null);
  for (const o of r.offers) {
    assert.equal(o.sourceUrl, input.finalUrl);
    assert.equal(o.observedAt, input.observedAt);
    assert.ok(o.excerpt);
  }
  assert.equal(r.ticketStatus, undefined);
  assert.equal(r.ticketsUrl, undefined);
  assert.equal(r.resaleUrl, undefined);
});
for (const status of [403, 429, 500, 204])
  test(`does not treat HTTP${status} as empty stock`, () => rejected({ status }));
for (const finalUrl of [
  "https://evil.invalid/",
  "https://hellfest.fr/old/",
  "http://hellfest.fr/",
  "https://user@hellfest.fr/",
  "https://hellfest.fr/?year=2026",
])
  test(`rejects unexpected final URL ${finalUrl}`, () => rejected({ finalUrl }));
for (const observedAt of [
  "bad",
  "2026-02-30T15:30:00.000Z",
  "2026-11-22",
  "2026-11-22T15:30:00+00:00",
])
  test(`requires valid precise UTC observation ${observedAt}`, () => rejected({ observedAt }));
for (const [name, mutate] of Object.entries({
  stale: (h) => h.replaceAll("2027", "2026"),
  missingDate: (h) => h.replace("<h2>17 - 20 juin 2027</h2>", ""),
  hiddenContainer: (h) =>
    h.replace('class="home__tickets-cards"', 'hidden class="home__tickets-cards"'),
  hiddenAncestor: (h) =>
    h.replace("<body>", '<body><div aria-hidden="true">').replace("</body>", "</div></body>"),
  hiddenPrice: (h) =>
    h.replace(
      'class="home__ticket-card-price"',
      'style="display:none" class="home__ticket-card-price"',
    ),
  duplicateCard: (h) =>
    h.replace("</body>", h.match(/<div class="home__ticket-card">[\s\S]*?<\/div>/)[0] + "</body>"),
  duplicateLabel: (h) => h.replace("<i>Pass</i> 1 jour", "<i>Pass</i> 4 jours"),
  extras: (h) => h.replace("<i>Pass</i> 4 jours", "VIP 4 jours"),
  currency: (h) => h.replace("389€", "389USD"),
  badPrice: (h) => h.replace("389€", "389,1€"),
  conflictingStatus: (h) =>
    h.replace(
      "home__ticket-card-soldout home__ticket-card-banner",
      "home__ticket-card-soldout home__ticket-card-comingsoon home__ticket-card-banner",
    ),
  unsupportedStatus: (h) => h.replace("complet", "available"),
  scriptOnly: (h) => `<script type="text/plain">${h}</script>`,
}))
  test(`fails closed without partial proposals: ${name}`, () => rejected({ html: mutate(html) }));
test("decimal prices preserve cents; generic resale/sale prose cannot change tier statuses", () => {
  const r = parse({
    html: html
      .replace("389€", "389,50 €")
      .replace("</body>", "<p>REVENTE OFFICIELLE OUVERTE: tickets available now</p></body>"),
  });
  assert.equal(r.offers[0].price.amountMinor, 38950);
  assert.deepEqual(
    r.offers.map((o) => o.status),
    ["sold_out", "not_on_sale"],
  );
});
test("cannot borrow known price or status from a different card", () =>
  rejected({ html: html.replace("À VENIR", "") }));
test("oversized response cannot become a proposal", () =>
  rejected({ html: " ".repeat(2_000_001) }));
test("duplicate price field is ambiguous, even with same value", () =>
  rejected({ html: html.replace("389€", '389€</div><div class="home__ticket-card-price">389€') }));
test("script/current year cannot repair an archived document identity", () =>
  rejected({
    html: html.replaceAll("2027", "2026").replace("</body>", "<script>2027</script></body>"),
  }));
test("no page-wide inventory assertion or buy link can invent an available tier", () => {
  const r = parse({
    html: html.replace(
      "</body>",
      '<a href="https://tickets.hellfest.fr/">Buy tickets now</a><p>All passes in stock</p></body>',
    ),
  });
  assert.deepEqual(
    r.offers.map((o) => o.status),
    ["sold_out", "not_on_sale"],
  );
});
