import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  availableFestivalMonths,
  festivalDateInterval,
  festivalOverlapsMonth,
  formatFestivalDateRange,
} from "../lib/festival-dates.ts";
import { FestivalExplorer } from "../components/FestivalExplorer.tsx";
import { FestivalViews } from "../components/FestivalViews.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { festival } from "./support/catalog.ts";

const crossMonth = { ...festival, startDate: "2027-06-26", endDate: "2027-07-03" };
const crossYear = { ...festival, startDate: "2027-12-30", endDate: "2028-01-02" };

test("discovery includes every overlapped month, including March and year boundaries", () => {
  assert.deepEqual(
    availableFestivalMonths([crossMonth, crossYear, { startDate: "2027-03-25" }]),
    [1, 3, 6, 7, 12],
  );
  for (const month of [6, 7]) assert.equal(festivalOverlapsMonth(crossMonth, month), true);
  assert.equal(festivalOverlapsMonth(crossMonth, 8), false);
  assert.equal(festivalOverlapsMonth(crossYear, 12, 2027), true);
  assert.equal(festivalOverlapsMonth(crossYear, 1, 2028), true);
  assert.equal(festivalOverlapsMonth(crossYear, 1, 2027), false);
  assert.equal(festivalOverlapsMonth(crossYear, 12, 2028), false);
  assert.deepEqual(
    availableFestivalMonths([{ startDate: "2027-05-01", endDate: "2027-08-31" }]),
    [5, 6, 7, 8],
  );
});

test("missing, malformed, reversed and impossible dates do not invent calendar intervals", () => {
  for (const item of [
    {},
    { endDate: "2027-07-03" },
    { startDate: "2027-02-29" },
    { startDate: "2027-04-31" },
    { startDate: "2027-06-26", endDate: "bad" },
    { startDate: "2027-06-26", endDate: "2027-06-01" },
  ]) {
    assert.equal(festivalDateInterval(item), null);
    assert.deepEqual(availableFestivalMonths([item]), []);
    assert.equal(formatFestivalDateRange(item, "en-GB", "TBA"), "TBA");
  }
  assert.equal(festivalOverlapsMonth(crossMonth, 0), false);
  assert.equal(festivalOverlapsMonth(crossMonth, 13), false);
  assert.equal(festivalOverlapsMonth(crossMonth, NaN), false);
  assert.equal(
    festivalOverlapsMonth({ startDate: "2028-02-29", endDate: "2028-03-01" }, 2, 2028),
    true,
  );
  assert.equal(
    festivalOverlapsMonth({ startDate: "2028-02-29", endDate: "2028-03-01" }, 3, 2028),
    true,
  );
  assert.equal(festivalOverlapsMonth({ startDate: "2028-02-29" }, 2, 2028), true);
});

function render(Component, items, language) {
  return renderToStaticMarkup(
    h(
      LanguageProvider,
      { initialLanguage: language },
      h(LocalPlannerProvider, null, h(Component, { festivals: items })),
    ),
  );
}

for (const [language, locale, march, july] of [
  ["en", "en-US", "March", "Jul"],
  ["de", "de-DE", "März", "Juli"],
  ["ru", "ru-RU", "март", "июл."],
]) {
  test(`calendar links use the stored edition year rather than the event month in ${language}`, () => {
    const calendar = render(
      FestivalViews,
      [
        { ...crossYear, editionYear: 2026 },
        {
          ...festival,
          slug: "year-unknown",
          startDate: "2027-12-31",
          endDate: undefined,
          editionYear: undefined,
        },
      ],
      language,
    );
    const links = [...calendar.matchAll(/<a role="listitem" href="([^"]+)"/g)].map(([, href]) =>
      href.replace(/\/$/, ""),
    );
    assert.deepEqual(links, [`/festivals/${festival.slug}/2026`, "/festivals/year-unknown"]);
  });

  test(`actual calendar and discovery render truthful intervals and dynamic month options in ${language}`, () => {
    const html = render(FestivalViews, [crossMonth], language);
    assert.ok(html.includes(formatFestivalDateRange(crossMonth, locale, "")));
    assert.ok(html.includes(july));
    const explorer = render(
      FestivalExplorer,
      [crossMonth, { ...festival, slug: "march", startDate: "2027-03-25", endDate: undefined }],
      language,
    );
    assert.match(explorer, /<option value="03">/);
    assert.match(explorer, /<option value="07">/);
    assert.ok(explorer.toLowerCase().includes(march.toLowerCase()));
    assert.doesNotMatch(explorer, /<option value="04">/);
    const rollover = render(FestivalViews, [crossYear], language);
    assert.ok(rollover.includes(formatFestivalDateRange(crossYear, locale, "")));
    assert.ok(rollover.includes("2028"));
    const leap = render(
      FestivalViews,
      [{ ...festival, startDate: "2028-02-29", endDate: undefined }],
      language,
    );
    assert.ok(leap.includes('dateTime="2028-02-29"'));
    const missing = render(FestivalViews, [{ ...festival, startDate: undefined }], language);
    assert.doesNotMatch(missing, /class="calendarGrid"[^]*dateTime=/);
  });
}

test("date-only rendering and month membership do not depend on the process timezone", () => {
  const original = process.env.TZ;
  try {
    for (const timeZone of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Europe/Berlin"]) {
      process.env.TZ = timeZone;
      assert.equal(formatFestivalDateRange(crossYear, "en-GB", ""), "30 Dec 2027 – 2 Jan 2028");
      assert.equal(festivalOverlapsMonth(crossYear, 1, 2028), true);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
