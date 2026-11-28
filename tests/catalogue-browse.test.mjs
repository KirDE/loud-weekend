import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogueBrowse } from "../components/CatalogueBrowse.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { catalogueBrowse } from "../lib/catalog/browse.ts";

test("browse lists only recorded countries, overlapping months, edition years and public artist keys", () => {
  const festivals = [
    { countryCode: "DE", startDate: "2027-06-30", endDate: "2027-07-02" },
    { countryCode: "DE", startDate: "2027-06-15" },
    { countryCode: "CZ" },
  ];
  const editions = [
    { editionYear: 2027, recordState: "current" },
    { editionYear: 2027, recordState: "current" },
  ];
  const artists = [{ slug: "artist-a", name: "Artist A", internalEvidence: "not needed" }];
  assert.deepEqual(catalogueBrowse(festivals, editions, artists), {
    countries: ["DE", "CZ"],
    months: [6, 7],
    years: [2027],
    hasArchive: false,
    artists: [{ slug: "artist-a", name: "Artist A" }],
  });
  const archive = { editionYear: 2025, recordState: "archived" };
  const future = { editionYear: 2029, recordState: "tracking", provenance: [] };
  const unverified = catalogueBrowse(festivals, [...editions, archive, future], artists);
  assert.equal(unverified.hasArchive, false);
  assert.deepEqual(unverified.years, [2027]);

  const complete = catalogueBrowse(
    festivals,
    [
      ...editions,
      { ...archive, snapshotAt: "2025-10-01T00:00:00Z" },
      { ...future, provenance: [{ field: "edition" }] },
    ],
    artists,
  );
  assert.equal(complete.hasArchive, true);
  assert.deepEqual(complete.years, [2029, 2027, 2025]);
});

for (const language of ["en", "de", "ru"]) {
  test(`browse links to the recorded seasons in ${language}`, () => {
    const data = {
      countries: [],
      months: [],
      years: [2028, 2027, 2026],
      hasArchive: true,
      artists: [],
    };
    const html = renderToStaticMarkup(
      h(LanguageProvider, { initialLanguage: language }, h(CatalogueBrowse, { data })),
    );
    const links = [...html.matchAll(/href="([^"]+)"[^>]*>([0-9]{4})<\/a>/g)];
    assert.deepEqual(
      links.map(([, url]) => url.replace(/\/$/, "")),
      data.years.map((year) => `/${language}/editions/${year}`),
    );
    assert.match(html, /href="\/archive\/?"/);
  });
}
