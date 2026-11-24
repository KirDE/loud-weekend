import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArchiveContent,
  EditionYearContent,
  FestivalEditionContent,
} from "../components/PublicCatalogPages.tsx";
import { LanguageProvider, translate } from "../components/LanguageProvider.tsx";
import { festival } from "./support/catalog.ts";

const notice = {
  festivalSlug: "rock-en-seine",
  editionYear: 2027,
  lifecycle: "hiatus",
  announcedReturnYear: 2028,
  alternativeEvent: "under_consideration",
  sourceUrl: "https://www.rockenseine.com/",
  observedAt: "2026-11-22T18:56:40.000Z",
  approvedAt: "2026-11-22T19:00:00.000Z",
};
const paused = {
  ...festival,
  slug: "rock-en-seine",
  name: "Rock en Seine",
  officialUrl: notice.sourceUrl,
  recordState: "current",
  completeness: "complete",
  provenance: [],
  startDate: "2027-08-25",
  endDate: "2027-08-29",
  editionLifecycle: notice,
};
const render = (locale, element) =>
  renderToStaticMarkup(h(LanguageProvider, { initialLanguage: locale }, element));
const detail = (item) =>
  h(FestivalEditionContent, { item, artistSlugs: { "Sample Artist": "sample-artist" } });
for (const locale of ["en", "de", "ru"]) {
  test("current edition row and detail suppress old scheduled facts in " + locale, () => {
    const before = structuredClone(paused);
    const row = render(locale, h(EditionYearContent, { year: 2027, items: [paused] }));
    const html = render(locale, detail(paused));
    for (const output of [row, html]) {
      assert.ok(output.includes(translate(locale, "editionHiatus")));
      assert.doesNotMatch(
        output,
        /Sample Artist|sample-artist|2027-08-25|2027-08-29|lineupSection|status confirmed/,
      );
      // No formatted August dates, either.
      const formatted = new Intl.DateTimeFormat({ en: "en-GB", de: "de-DE", ru: "ru-RU" }[locale], {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2027-08-25T12:00:00Z"));
      assert.ok(!output.includes(formatted));
    }
    assert.match(html, /dateTime="2026-11-22T18:56:40.000Z"/);
    assert.match(html, /href="https:\/\/www.rockenseine.com\/"/);
    assert.doesNotMatch(html, /contentHash|approvedAt|reviewer|audit/);
    assert.deepEqual(paused, before);
  });
  test(
    "archived captured dates and roster remain visible; unknown current remains unchanged in " +
      locale,
    () => {
      // A current notice cannot rewrite an archived snapshot, even if supplied with it.
      const archived = {
        ...paused,
        recordState: "archived",
        editionYear: 2026,
        startDate: "2026-08-25",
        endDate: "2026-08-29",
        snapshotAt: "2026-09-01T00:00:00Z",
      };
      const html = render(locale, detail(archived));
      assert.match(html, /Sample Artist|sample-artist/);
      assert.match(html, /lineupSection|status confirmed/);
      assert.ok(!html.includes(translate(locale, "editionHiatus")));
      const archive = render(locale, h(ArchiveContent, { archived: [archived], future: [] }));
      assert.ok(!archive.includes(translate(locale, "editionHiatus")));
      assert.match(archive, /2026/);
      const unknown = render(locale, detail({ ...paused, editionLifecycle: undefined }));
      assert.match(unknown, /Sample Artist/);
      assert.ok(!unknown.includes(translate(locale, "editionHiatus")));
    },
  );
}
test("current editions reject malformed or transferred notices rather than showing stale dates", () => {
  for (const item of [
    { ...paused, slug: "another-festival" },
    { ...paused, editionYear: 2028 },
    { ...paused, editionLifecycle: { ...notice, reviewState: "pending" } },
    { ...paused, editionLifecycle: null },
  ]) {
    assert.throws(() => render("en", detail(item)));
    assert.throws(() => render("en", h(EditionYearContent, { year: 2027, items: [item] })));
  }
});
