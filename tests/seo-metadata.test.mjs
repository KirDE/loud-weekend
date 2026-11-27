import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { festivalDescription, festivalMusicEvent } from "../lib/seo.ts";
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

test("festival descriptions localize published dates and announced acts without promising a full roster", () => {
  const item = {
    ...festival,
    lineup: ["Sample Artist", "Second Act", "Third Act", "Fourth Act"],
  };
  for (const [language, date, label] of [
    ["en", /Jun 10, 2027/, "Announced acts"],
    ["de", /10. Juni? 2027/, "Angekündigte Acts"],
    ["ru", /10 июн.*2027/, "Объявленные артисты"],
  ]) {
    const description = festivalDescription(item, language);
    assert.match(description, /^Synthetic Fest 2027 · Sample City, Testland · /);
    assert.match(description, date);
    assert.ok(description.includes(label));
    assert.match(description, /Sample Artist.*Second Act.*Third Act/);
    assert.equal(description.match(/Sample Artist/g).length, 1);
    assert.doesNotMatch(description, /Fourth Act|tickets|playlist/);
  }
});

test("festival descriptions do not invent missing edition, dates, locality or acts", () => {
  const description = festivalDescription(
    {
      ...festival,
      editionYear: undefined,
      startDate: "2027-02-30",
      endDate: undefined,
      city: "",
      headliners: [],
      lineup: [],
    },
    "de",
  );
  assert.equal(description, "Synthetic Fest · Testland.");
  const fallback = festivalDescription(
    {
      ...festival,
      editionYear: undefined,
      startDate: undefined,
      endDate: undefined,
      city: "",
      country: "",
      headliners: [],
      lineup: [],
    },
    "ru",
  );
  assert.equal(fallback, "Synthetic Fest · Информация о фестивале на Loud Weekend.");
});
