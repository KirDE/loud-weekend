import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import {
  observeRoskildeStock,
  ROSKILDE_STOCK_SOURCE as source,
  ROSKILDE_PRODUCTS_URL as url,
} from "../lib/ingestion/adapters/roskilde-stock.ts";
const html = readFileSync(
  new URL("./fixtures/roskilde/tickster-products.html", import.meta.url),
  "utf8",
);
// Actual historical observation, NOT a simulated fresh live refresh.
const at = "2026-11-22T18:03:19.690Z";
const parse = (body = html, s = source, t = { status: 200, finalUrl: url }, time = at) =>
  observeRoskildeStock(body, s, time, t);
const mutate = (fn) => {
  const $ = load(html);
  const group = $("#ProductsTable > article").filter(
    (_, el) => $(el).find("h3").text().trim() === "Partout",
  );
  const details = group.next();
  const standard = details.children("article").first();
  fn($, group, details, standard);
  return $.html();
};
test("actual minimized shop DOM binds ordinary full2027 standard while children and Wednesday are sold out", () => {
  const c = parse();
  assert.equal(c.ticketStatus, "available");
  assert.equal(c.ticketsUrl, url);
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.evidence.length, 2);
  assert.ok(c.evidence.every((e) => e.sourceUrl === url && e.observedAt === at));
  assert.equal(c.startDate, undefined);
  assert.equal(c.endDate, undefined);
  assert.equal(c.lineup, undefined);
  assert.equal(c.price, undefined);
  assert.equal(c.inventory, undefined);
  assert.deepEqual(
    Object.keys(c).sort(),
    [
      "schemaVersion",
      "festivalSlug",
      "sourceUrl",
      "fetchedAt",
      "observedEditionYears",
      "warnings",
      "ticketStatus",
      "ticketsUrl",
      "evidence",
    ].sort(),
  );
  assert.doesNotMatch(JSON.stringify(c), /quantity152|2650|session|cookie|token|quantityOptions/);
});
for (const [label, fn] of [
  [
    "wrong edition",
    ($, g) =>
      g
        .find("p")
        .text(
          "Giver adgang til hele Roskilde Festival 2026 fra lørdag 26. juni til og med lørdag 3. juli.",
        ),
  ],
  ["wrong festival", ($, g) => g.find("p").text(g.find("p").text().replace("Roskilde", "Other"))],
  ["changed date", ($, g) => g.find("p").text(g.find("p").text().replace("26. juni", "27. juni"))],
  ["no edition description", ($, g) => g.find("p").remove()],
  ["duplicate group", ($, g, d) => d.after(g.clone())],
  ["duplicate standard", ($, g, d, s) => d.append(s.clone())],
  ["no standard", ($, g, d, s) => s.remove()],
  ["donation named standard", ($, g, d, s) => s.find("p").first().text("Donation only")],
  [
    "child renamed standard",
    ($, g, d, s) => {
      s.remove();
      d.find("h3")
        .filter((_, e) => $(e).text().includes("Børnebillet"))
        .text("Standard");
    },
  ],
  ["no table", ($) => $("#ProductsTable").remove()],
  ["duplicate table", ($) => $("body").append($("#ProductsTable").clone())],
  ["wrong title", ($) => $("title").text("Session expired")],
  ["detached variants", ($, g) => g.after("<p>Unrelated group</p>")],
  ["select absent", ($, g, d, s) => s.find("select").remove()],
  ["duplicate select", ($, g, d, s) => s.append(s.find("select").clone())],
  ["disabled select", ($, g, d, s) => s.find("select").attr("disabled", "")],
  ["aria disabled", ($, g, d, s) => s.find("select").attr("aria-disabled", "true")],
  ["disabled ancestor", ($, g, d, s) => s.attr("aria-disabled", "true")],
  ["inert ancestor", ($, g) => g.parent().attr("inert", "")],
  ["disabled fieldset", ($, g, d, s) => s.find("select").wrap("<fieldset disabled></fieldset>")],
  ["hidden group", ($, g) => g.attr("hidden", "")],
  ["hidden variants", ($, g, d) => d.attr("aria-hidden", "true")],
  ["inline hidden ancestor", ($, g) => g.parent().attr("style", "display: none !important")],
  ["hidden control", ($, g, d, s) => s.find("select").attr("style", "visibility:hidden")],
  ["no positive options", ($, g, d, s) => s.find("option").slice(1).remove()],
  ["all options disabled", ($, g, d, s) => s.find("option").attr("disabled", "")],
  ["sold out standard", ($, g, d, s) => s.append("<span>Udsolgt</span>")],
  ["sold out group", ($, g) => g.append("<span>Udsolgt</span>")],
  ["waitlist", ($, g, d, s) => s.append("<span>Venteliste</span>")],
  ["malformed quantity", ($, g, d, s) => s.find("option").eq(1).attr("value", "-1")],
  ["duplicate quantities", ($, g, d, s) => s.find("option").eq(1).attr("value", "0")],
  ["missing zero", ($, g, d, s) => s.find("option").first().remove()],
  [
    "script only table",
    ($) => {
      const t = $("#ProductsTable");
      t.replaceWith($('<script type="text/plain">').text(t.toString()));
    },
  ],
])
  test(label + " rejects instead of healthy empty or festival sold_out", () =>
    assert.throws(() => parse(mutate(fn)), /not verified/),
  );
for (const status of [201, 204, 206, 301, 302, 403, 429, 500])
  test("HTTP " + status + " is not stock", () =>
    assert.throws(() => parse(html, source, { status, finalUrl: url })),
  );
for (const [label, s] of [
  ["wrong slug", { ...source, festivalSlug: "other" }],
  ["wrong year", { ...source, editionYear: 2026 }],
  ["other sale", { ...source, url: url.replace("vgkw6td2h3rrfkv", "3e9u8rgkhdlw9dg") }],
  ["fetch override", { ...source, fetchUrl: url }],
  ["follow override", { ...source, followLinkPattern: "products" }],
  ["headers override", { ...source, headers: { Cookie: "test" } }],
])
  test(label + " rejected", () => assert.throws(() => parse(html, s)));
test("redirect/session/empty/unbounded invalid observation rejected", () => {
  for (const finalUrl of [
    url + "?session=x",
    url.replace("products", "selectproductgroup"),
    "https://example.org/products",
    "",
  ])
    assert.throws(() => parse(html, source, { status: 200, finalUrl }));
  for (const time of ["bad", "2026-99-99T00:00:00Z"])
    assert.throws(() => parse(html, source, undefined, time));
  assert.throws(() => parse(""));
  assert.throws(() => parse("x".repeat(2_000_001)));
});
test("another positive day or donation does not rescue unavailable full standard or infer global soldout", () => {
  assert.throws(() => parse(mutate(($, g, d, s) => s.find("select").attr("disabled", ""))));
});
