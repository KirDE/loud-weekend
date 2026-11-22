import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { observeTolminatorStock, TOLMINATOR_PRODUCT } from "../lib/ingestion/adapters/tolminator-stock.ts";
const fixture = readFileSync(new URL("./fixtures/ticket-status/tolminator-ordinary.html", import.meta.url), "utf8");
const at = "2026-11-22T17:01:23Z";
const observe = (html = fixture, url = TOLMINATOR_PRODUCT, year = 2027, time = at) => observeTolminatorStock(html, url, year, time);
const metadata = (change) => fixture.replace(/(<script[^>]*>)([^]*?)(<\/script>)/, (_, a, json, c) => {
  const document = JSON.parse(json); change(document['@graph'][0], document); return a + JSON.stringify(document) + c;
});
test("Tolminator exact ordinary stock observation never projects seller dates or price into the catalogue", () => {
  const result = observe();
  assert.equal(result.status, "available");
  assert.equal(result.ticketsUrl, TOLMINATOR_PRODUCT);
  assert.equal(result.warning, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['excerpt', 'status', 'ticketsUrl']);
});
for (const [name, html] of [
  ['price/link without stock', metadata(e => delete e.offers.offers[0].availability)],
  ['sold out', metadata(e => e.offers.offers[0].availability = 'Sold out')],
  ['unknown stock enum', metadata(e => e.offers.offers[0].availability = 'https://schema.org/InStock')],
  ['archived edition', fixture.replaceAll('2027', '2026')],
  ['upgrade instead of entry', fixture.replaceAll('FESTIVALSKA VSTOPNICA', 'VIP UPGRADE')],
  ['camping only', metadata(e => e.name = 'TOLMINATOR 2027 CAMPING')],
  ['foreign event', metadata(e => e.url = 'https://foreign.example/')],
  ['foreign action', metadata(e => e.offers.offers[0].url = 'https://foreign.example/')],
  ['mismatched currency', metadata(e => e.offers.offers[0].priceCurrency = 'USD')],
  ['mismatched aggregate', metadata(e => e.offers.highPrice = '220')],
  ['mismatched price', metadata(e => e.offers.offers[0].price = '220')],
  ['future sale', metadata(e => e.offers.offers[0].validFrom = '2027-01-01T00:00:00Z')],
  ['expired sale', metadata(e => e.offers.offers[0].validThrough = '2026-11-01T00:00:00Z')],
  ['missing sale window', metadata(e => delete e.offers.offers[0].validThrough)],
  ['invalid sale window', metadata(e => e.offers.offers[0].validFrom = 'tomorrow')],
  ['multiple offers', metadata(e => e.offers.offers.push(e.offers.offers[0]))],
  ['duplicate Event', metadata((e,d) => d['@graph'].push(e))],
  ['cancelled Event', metadata(e => e.eventStatus = 'https://schema.org/EventCancelled')],
  ['changed dates', metadata(e => e.endDate = '2027-08-01T00:00:00+02:00')],
  ['hidden identity', fixture.replace('<h1 ', '<h1 hidden ')],
  ['hidden ancestor', fixture.replace('<body>', '<body><section hidden>').replace('</body>', '</section></body>')],
  ['CSS hidden buy', fixture.replace('class="description-buy-link"', 'style="display:none" class="description-buy-link"')],
  ['disabled buy', fixture.replace('class="description-buy-link"', 'aria-disabled="true" class="description-buy-link"')],
  ['disabled ancestor', fixture.replace('<body>', '<body><section aria-disabled="true">').replace('</body>', '</section></body>')],
  ['visible conflict', fixture.replace('</body>', '<p>Razprodano</p></body>')],
  ['invalid JSON', fixture.replace('"@graph"', 'bad-json')],
  ['unrecognized JSON structure', metadata((e,d) => delete d['@graph'])],
  ['no metadata', fixture.replace(/<script[^]*?<\/script>/, '')],
  ['missing price', fixture.replace('210,00', '220,00')],
  ['challenge document', '<title>Just a moment</title>'],
]) test(`Tolminator rejects ${name} without inventing a sellout`, () => {
  const result = observe(html); assert.equal(result.status, undefined); assert.ok(result.warning);
});
test('Tolminator binds exact reviewed route, edition and observation time', () => {
  for (const args of [ [fixture,TOLMINATOR_PRODUCT+'?x=1'], [fixture,TOLMINATOR_PRODUCT,2028], [fixture,TOLMINATOR_PRODUCT,2027,'invalid'], [fixture,'https://tolminator.mojekarte.si/si/vstopnice.html'] ]) {
    assert.ok(observe(...args).warning);
  }
  assert.ok(observe('x'.repeat(2_000_001)).warning);
});
