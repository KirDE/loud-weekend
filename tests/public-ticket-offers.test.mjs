import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalComparisonTicket } from "../components/FestivalComparison.tsx";
import { FestivalDetail } from "../components/FestivalDetail.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { festival } from "./support/catalog.ts";
import { ticketPresentation, hasAvailableTickets } from "../lib/tickets.ts";
import { festivalMusicEvent } from "../lib/seo.ts";

const ticketOffers = {
  editionYear: 2027,
  sourceUrl: "https://hellfest.fr/",
  observedAt: "2026-11-22T15:30:00.000Z",
  offers: [
    {
      key: "full",
      kind: "full_pass",
      status: "sold_out",
      price: { amountMinor: 38900, currency: "EUR", fees: "unknown" },
      saleDateText: null,
    },
    {
      key: "day",
      kind: "day_pass",
      status: "not_on_sale",
      price: null,
      saleDateText: "7 juillet - 13h",
    },
  ],
};
const render = (language, item) =>
  renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      { initialLanguage: language },
      React.createElement(
        LocalPlannerProvider,
        null,
        React.createElement(FestivalDetail, { item, festivals: [item], artistSlugs: {} }),
      ),
    ),
  );
for (const [lang, sold, notSale, noPrice, fees] of [
  ["en", "Sold out", "Not on sale yet", "Price not announced", "Fees: unknown"],
  [
    "de",
    "Ausverkauft",
    "Noch nicht im Verkauf",
    "Preis noch nicht angekündigt",
    "Gebühren: unbekannt",
  ],
  ["ru", "Распродано", "Продажи ещё не открыты", "Цена не объявлена", "Комиссии неизвестны"],
])
  test(`actual detail renders approved independent tiers and honest unknowns in ${lang}`, () => {
    const item = { ...festival, ticketOffers };
    const before = structuredClone(item);
    const html = render(lang, item);
    const section = html.match(/<section class="ticketOfferSection"[\s\S]*?<\/section>/)?.[0];
    assert.ok(section);
    for (const text of [
      sold,
      notSale,
      noPrice,
      fees,
      "389",
      "7 juillet - 13h",
      "2027",
      "https://hellfest.fr/",
    ])
      assert.ok(section.includes(text), text);
    assert.equal((section.match(/<article /g) ?? []).length, 2);
    assert.doesNotMatch(section, /InStock|datetime="2027|cart|VIP|camping|contentHash|reviewState/);
    assert.match(section, /<time dateTime="2026-11-22T15:30:00.000Z">/);
    const comparison = renderToStaticMarkup(
      React.createElement(
        LanguageProvider,
        { initialLanguage: lang },
        React.createElement(FestivalComparisonTicket, {
          item: {
            ...item,
            ticketStatus: "available",
            ticketsUrl: "https://camping.example.invalid/",
          },
        }),
      ),
    );
    assert.match(comparison, /href="https:\/\/hellfest.fr\/"/);
    assert.doesNotMatch(comparison, /camping.example|data-ticket-status="available"/);
    assert.deepEqual(item, before);
    assert.doesNotMatch(render(lang, festival), /ticketOfferSection/);
  });
test("approved hiatus hides previously reviewed ticket tiers without changing the evidence", () => {
  const item = {
    ...festival,
    editionYear: ticketOffers.editionYear,
    ticketOffers,
    editionLifecycle: {
      festivalSlug: festival.slug,
      editionYear: ticketOffers.editionYear,
      lifecycle: "hiatus",
      announcedReturnYear: null,
      alternativeEvent: null,
      sourceUrl: festival.officialUrl,
      observedAt: ticketOffers.observedAt,
      approvedAt: ticketOffers.observedAt,
    },
  };
  const before = structuredClone(item);
  for (const lang of ["en", "de", "ru"]) {
    const html = render(lang, item);
    assert.match(html, /data-ticket-status="hiatus"/);
    assert.doesNotMatch(html, /ticketOfferSection/);
  }
  assert.deepEqual(item, before);
});

test("mixed tiers suppress unrelated global SEO stock without inventing a purchase offer", () => {
  for (const ticketStatus of ["available", "low", "sold_out", "unknown"]) {
    const item = {
      ...festival,
      ticketStatus,
      ticketsUrl: "https://tickets.example.invalid/",
      ticketOffers,
    };
    assert.equal(festivalMusicEvent(item).offers, undefined);
    assert.equal(item.ticketStatus, ticketStatus);
    assert.equal(hasAvailableTickets(item), false);
    assert.deepEqual(ticketPresentation(item), {
      status: "unknown",
      href: "https://hellfest.fr/",
      label: "ticketsInfo",
    });
  }
});
