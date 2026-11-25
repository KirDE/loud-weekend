import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { festivalMusicEvent } from "../lib/seo.ts";
import { festival } from "./support/catalog.ts";
const sitemapSource = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");

test("all indexable route classes define self-canonical metadata", async () => {
  const routes = [
    "festivals/[slug]",
    "artists/[slug]",
    "countries/[code]",
    "months/[month]",
    "archive",
    "submit",
    "[lang]",
    "festivals/[slug]/[year]",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/${route}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, route.startsWith("artists") ? /artistMetadata/ : /canonical/);
  }
  for (const route of ["editions/[year]", "[lang]/editions/[year]"]) {
    const source = await readFile(new URL(`../app/${route}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /seasonMetadata\(/);
  }
  const seasonPage = await readFile(new URL("../lib/season-page.tsx", import.meta.url), "utf8");
  assert.match(seasonPage, /canonical:/);
});

test("sitemap uses content timestamps rather than future event dates", () => {
  assert.match(sitemapSource, /readSitemapPublications/);
  assert.doesNotMatch(sitemapSource, /CATALOG_UPDATED_AT|lastModified:\s*(?:startDate|updatedAt)/);
});

test("MusicEvent omits unknown facts and maps verified ticket state", () => {
  const event = festivalMusicEvent(
    { ...festival, startDate: "2027-02-30", ticketStatus: "unknown" },
    "de",
  );
  assert.equal(event.startDate, undefined);
  assert.equal(event.eventStatus, undefined);
  assert.equal(event.offers, undefined);
  assert.equal(event.location.address.addressLocality, festival.city);
  assert.deepEqual(event.performer, [{ "@type": "MusicGroup", name: "Sample Artist" }]);
  assert.equal(event.url, "https://loudweekend.eu/de/festivals/synthetic-fest/");
  const verified = festivalMusicEvent({
    ...festival,
    ticketStatus: "sold_out",
    ticketsUrl: "https://example.test/tickets",
  });
  assert.equal(verified.startDate, festival.startDate);
  assert.equal(verified.offers.availability, "https://schema.org/SoldOut");
});
