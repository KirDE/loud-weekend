import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalGuideContent } from "../components/FestivalGuideContent.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import {
  festivalGuides,
  guideTopics,
  isGuideTopic,
  selectGuideEditions,
} from "../lib/festival-guides.ts";

const edition = {
  slug: "fixture",
  editionYear: 2027,
  status: "confirmed",
  countryCode: "DE",
  recordState: "current",
  startDate: "2027-07-03",
  endDate: "2027-07-05",
  provenance: [{ field: "dates" }],
};

test("guide membership uses only current edition facts with complete date evidence", () => {
  const split = {
    ...edition,
    slug: "split",
    startDate: "2027-06-05",
    endDate: "2027-06-08",
    provenance: [{ field: "startDate" }, { field: "endDate" }],
  };
  const missing = [
    { ...edition, slug: "future", recordState: "tracking" },
    { ...edition, slug: "old", recordState: "archived" },
    { ...edition, slug: "tba", status: "tba" },
    { ...edition, slug: "unknown", endDate: null },
    { ...edition, slug: "wrong-year", editionYear: 2026 },
    { ...edition, slug: "wrong-date", endDate: "2027-06-31" },
    { ...edition, slug: "no-proof", provenance: [{ field: "lineup" }] },
    { ...edition, slug: "partial-proof", provenance: [{ field: "startDate" }] },
  ];
  const foreign = { ...edition, slug: "foreign", countryCode: "AT" };
  const short = { ...edition, slug: "short", endDate: "2027-07-04" };
  const paused = {
    ...edition,
    slug: "paused",
    officialUrl: "https://festival.example.test/",
    editionLifecycle: {
      festivalSlug: "paused",
      editionYear: 2027,
      lifecycle: "hiatus",
      announcedReturnYear: 2028,
      alternativeEvent: "under_consideration",
      sourceUrl: "https://festival.example.test/",
      observedAt: "2026-11-22T18:56:40.000Z",
      approvedAt: "2026-11-22T19:00:00.000Z",
    },
  };
  const records = [edition, ...missing, split, foreign, short, paused];
  assert.deepEqual(
    selectGuideEditions("germany", records).map(({ slug }) => slug),
    ["split", "fixture", "short"],
  );
  assert.deepEqual(
    selectGuideEditions("multi-day", records).map(({ slug }) => slug),
    ["split", "fixture", "foreign"],
  );
});

test("the two guides have distinct editorial copy in each supported language", () => {
  assert.deepEqual(guideTopics, ["germany", "multi-day"]);
  assert.equal(isGuideTopic("anything-else"), false);
  for (const language of ["en", "de", "ru"]) {
    assert.notEqual(
      festivalGuides.germany[language].intro,
      festivalGuides["multi-day"][language].intro,
    );
    assert.equal(festivalGuides.germany[language].checklist.length, 2);
  }
});

for (const language of ["en", "de", "ru"]) {
  test(`guide results link to the edition whose dates qualify in ${language}`, () => {
    const nextEdition = {
      ...edition,
      editionYear: 2028,
      name: "Future Festival",
      startDate: "2028-12-30",
      endDate: "2029-01-02",
    };
    const items = selectGuideEditions("multi-day", [nextEdition]);
    const html = renderToStaticMarkup(
      h(
        LanguageProvider,
        { initialLanguage: language },
        h(FestivalGuideContent, { topic: "multi-day", items }),
      ),
    );
    assert.match(
      html,
      new RegExp(`href="/${language}/festivals/fixture/2028/?">Future Festival</a>`),
    );
    assert.match(html, new RegExp(`href="/${language}/?"`));
  });
}
