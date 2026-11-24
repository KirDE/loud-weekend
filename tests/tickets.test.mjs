import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ticketPresentation, hasAvailableTickets } from "../lib/tickets.ts";
import { festivalMusicEvent } from "../lib/seo.ts";
import { factsSchema } from "../lib/ingestion/agent-contract.ts";
import { FestivalComparisonTicket } from "../components/FestivalComparison.tsx";
import { FestivalDetail } from "../components/FestivalDetail.tsx";
import { LanguageProvider, translate } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { festival } from "./support/catalog.ts";

const cases = [
  ["available", "officialTickets", "InStock"],
  ["low", "ticketsLow", "LimitedAvailability"],
  ["not_on_sale", "ticketsNotOnSale", undefined],
  ["sold_out", "ticketsSoldOut", "SoldOut"],
  ["sales_ended", "ticketsSalesEnded", undefined],
  ["unavailable", "ticketsUnavailable", undefined],
  ["unknown", "ticketsUnknown", undefined],
];

for (const [status, label, availability] of cases) {
  test(`${status} keeps its meaning through ingestion, UI, filters and structured offers`, () => {
    const item = {
      ...festival,
      ticketStatus: status,
      ticketsUrl: "https://festival.example.test/tickets",
    };
    const before = structuredClone(item);
    assert.equal(factsSchema.parse({ ticketStatus: status }).ticketStatus, status);
    assert.deepEqual(ticketPresentation(item), { status, href: item.ticketsUrl, label });
    assert.equal(hasAvailableTickets(item), ["available", "low"].includes(status));
    const event = festivalMusicEvent(item);
    if (availability) assert.equal(event.offers.availability, `https://schema.org/${availability}`);
    else assert.equal(event.offers, undefined);
    for (const language of ["en", "de", "ru"]) {
      const html = renderToStaticMarkup(
        h(
          LanguageProvider,
          { initialLanguage: language },
          h(
            LocalPlannerProvider,
            null,
            h(FestivalDetail, { item, festivals: [item], artistSlugs: {} }),
          ),
        ),
      );
      assert.ok(html.includes(`data-ticket-status="${status}"`));
      assert.ok(html.includes(translate(language, label).replaceAll("&", "&amp;")));
      if (status !== "available") assert.ok(!html.includes(translate(language, "officialTickets")));
    }
    assert.deepEqual(item, before);
  });
}

test("missing links and legacy unavailable never invent sold-out or actionable offers", () => {
  for (const [status] of cases) {
    const item = { ...festival, ticketStatus: status, ticketsUrl: undefined };
    assert.equal(festivalMusicEvent(item).offers, undefined);
    assert.equal(hasAvailableTickets(item), false);
    const presentation = ticketPresentation(item);
    assert.equal(presentation.href, undefined);
    assert.equal(presentation.status, status === "available" ? "unknown" : status);
  }
  for (const status of ["unknown", "unavailable"]) {
    assert.equal(
      festivalMusicEvent({
        ...festival,
        ticketStatus: status,
        ticketsUrl: "https://festival.example.test/tickets",
      }).offers,
      undefined,
    );
  }
  assert.equal(factsSchema.safeParse({ ticketStatus: "maybe_sold_out" }).success, false);
});

test("unticketed admission is explicit across ingestion, EN/DE/RU, filters and SEO", () => {
  for (const ticketsUrl of [undefined, "https://festival.example.test/camping"]) {
    const item = { ...festival, ticketStatus: "free", ticketsUrl };
    assert.equal(factsSchema.parse({ ticketStatus: "free" }).ticketStatus, "free");
    assert.deepEqual(ticketPresentation(item), {
      status: "free",
      href: item.officialUrl,
      label: "ticketsFree",
    });
    assert.equal(hasAvailableTickets(item), false); // The filter is paid ticket inventory, not admission.
    assert.equal(festivalMusicEvent(item).isAccessibleForFree, true);
    assert.equal(festivalMusicEvent(item).offers, undefined);
    for (const language of ["en", "de", "ru"]) {
      const html = renderToStaticMarkup(
        h(
          LanguageProvider,
          { initialLanguage: language },
          h(
            LocalPlannerProvider,
            null,
            h(FestivalDetail, { item, festivals: [item], artistSlugs: {} }),
          ),
        ),
      );
      assert.ok(html.includes('data-ticket-status="free"'));
      assert.ok(html.includes(translate(language, "ticketsFree")));
      assert.ok(!html.includes(translate(language, "officialTickets")));
      assert.ok(!html.includes(translate(language, "ticketsInfo")));
      assert.ok(!html.includes("https://festival.example.test/camping"));
    }
  }
  assert.equal(festivalMusicEvent(festival).isAccessibleForFree, undefined);
});

// Render the very same ticket cell used by mixed-festival comparisons, including
// ancillary links and missing official URLs (never fall back to a paid extras URL).
test("comparison ticket cells preserve free and paid semantics in EN/DE/RU", () => {
  for (const language of ["en", "de", "ru"]) {
    for (const [status, label] of [["free", "ticketsFree"], ...cases]) {
      for (const ticketsUrl of [undefined, "https://festival.example.test/camping"]) {
        for (const officialUrl of [undefined, "https://festival.example.test/"]) {
          const item = { ...festival, ticketStatus: status, ticketsUrl, officialUrl };
          const html = renderToStaticMarkup(
            h(
              LanguageProvider,
              { initialLanguage: language },
              h(FestivalComparisonTicket, { item }),
            ),
          );
          const expectedLabel = status === "available" && !ticketsUrl ? "ticketsUnknown" : label;
          assert.ok(html.includes(translate(language, expectedLabel).replaceAll("&", "&amp;")));
          if (status === "free") {
            assert.ok(!html.includes("https://festival.example.test/camping"));
            assert.ok(!html.includes(translate(language, "officialTickets")));
            assert.equal(
              html.includes('<a href="https://festival.example.test/"'),
              Boolean(officialUrl),
            );
          } else
            assert.equal(
              html.includes('<a href="https://festival.example.test/camping"'),
              Boolean(ticketsUrl),
            );
        }
      }
    }
  }
});
