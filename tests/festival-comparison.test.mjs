import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalComparison } from "../components/FestivalComparison.tsx";
import { LanguageProvider, translate } from "../components/LanguageProvider.tsx";
import { festival } from "./support/catalog.ts";
import { compareFestivalLineups } from "../lib/festival-comparison.ts";

const festivals = ["a", "b", "c"].map((slug) => ({ slug, name: slug }));
const lineups = {
  artistSlugsByFestival: {
    a: ["all", "ab", "ac", "all"],
    b: ["all", "ab", "bc"],
    c: ["all", "ac", "bc"],
  },
  legacyFavoriteSlugs: {},
};

test("three-way comparison intersects each canonical pair and all three separately", () => {
  const comparison = compareFestivalLineups(festivals, lineups);
  assert.deepEqual(
    comparison.pairs.map((pair) => [pair.festivals.map((item) => item.slug), pair.shared]),
    [
      [
        ["a", "b"],
        ["all", "ab"],
      ],
      [
        ["a", "c"],
        ["all", "ac"],
      ],
      [
        ["b", "c"],
        ["all", "bc"],
      ],
    ],
  );
  assert.deepEqual(comparison.sharedAcrossAll, ["all"]);
});

test("comparison keeps no overlap separate from an unknown lineup", () => {
  const result = compareFestivalLineups(festivals, {
    ...lineups,
    artistSlugsByFestival: { a: ["artist-1"], b: ["artist-2"] },
  });
  assert.deepEqual(
    result.pairs.map((pair) => pair.shared),
    [[], null, null],
  );
  assert.equal(result.sharedAcrossAll, null);
});

for (const language of ["en", "de", "ru"]) {
  test(`comparison headers open the displayed edition with a series fallback (${language})`, () => {
    const items = [
      { ...festival, editionYear: 2026 },
      { ...festival, slug: "future-fest", name: "Future Fest", editionYear: 2028 },
      { ...festival, slug: "unknown-fest", name: "Unknown Fest", editionYear: undefined },
    ];
    const html = renderToStaticMarkup(
      h(
        LanguageProvider,
        { initialLanguage: language },
        h(FestivalComparison, {
          festivals: items,
          origin: { latitude: 50, longitude: 10 },
          originLabel: "Sample City",
          favorites: [],
        }),
      ),
    );
    const header = html.match(/<thead>.*?<\/thead>/s)?.[0];
    assert.ok(header?.includes(translate(language, "planningDetail")));
    assert.deepEqual(
      Array.from(header.matchAll(/href="([^"]+)"/g), ([, href]) => href.replace(/\/$/, "")),
      ["/festivals/synthetic-fest/2026", "/festivals/future-fest/2028", "/festivals/unknown-fest"],
    );
  });
}
