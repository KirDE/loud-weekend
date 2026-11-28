import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { PlanningTools } from "../components/PlanningTools.tsx";
import { festival as fixture } from "./support/catalog.ts";
import { similarFestivals } from "../lib/planning.ts";

const anchor = {
  slug: "anchor",
  name: "Anchor",
  editionYear: 2027,
  genres: ["Doom Metal"],
  startDate: "2027-06-10",
  endDate: "2027-06-12",
  coordinates: { latitude: 50, longitude: 10 },
};
const festivals = [
  anchor,
  { slug: "canonical", name: "Unrelated billing spelling", genres: [] },
  { slug: "homonym", name: "Same printed name", genres: [], lineup: ["Shared Act"] },
  { slug: "favorite", name: "Favorite act", genres: [] },
  { slug: "genre", name: "Matching genre", genres: [" Doom   Metal ", "DOOM METAL"] },
  {
    slug: "nearby",
    name: "Nearby dates and venue",
    genres: [],
    startDate: "2027-06-15",
    endDate: "2027-06-16",
    coordinates: { latitude: 50, longitude: 11 },
  },
  {
    slug: "date-only",
    name: "Dates only",
    genres: [],
    startDate: "2027-06-10",
    endDate: "2027-06-12",
  },
  { slug: "distance-only", name: "Coordinates only", genres: [], coordinates: anchor.coordinates },
].map((item) => ({ ...item, editionYear: 2027 }));
const lineups = {
  artistSlugsByFestival: {
    anchor: ["shared"],
    canonical: ["shared", "shared"],
    homonym: ["other"],
    favorite: ["saved", "saved"],
  },
  legacyFavoriteSlugs: { "Saved Act": "saved" },
};

test("ranks canonical acts first and explains only observed related signals", () => {
  const results = similarFestivals(
    { ...anchor, lineup: ["Shared Act"] },
    festivals,
    {
      locale: "en",
      favorites: ["artist:saved", "Saved Act"],
      lineups,
    },
    10,
  );
  assert.deepEqual(
    results.map(({ festival }) => festival.slug),
    ["canonical", "favorite", "genre", "nearby"],
  );
  assert.equal(results[0].shared, 1);
  assert.equal(results[0].gapDays, null);
  assert.equal(results[0].distance, null);
  assert.equal(results[1].favoriteCount, 1);
  assert.deepEqual(results[2].sharedGenres, ["doom metal"]);
  assert.equal(results[3].gapDays, 3);
  assert.equal(results[3].distance, 71);
});

test("dates and distance are independent, and ties do not depend on input order", () => {
  const unknown = { slug: "none", name: "None", genres: [], lineup: ["Shared Act"] };
  assert.deepEqual(similarFestivals(unknown, festivals, { locale: "en" }), []);
  const sameName = ["b", "a"].map((slug) => ({
    slug,
    name: "Same name",
    genres: anchor.genres,
    editionYear: 2027,
  }));
  assert.deepEqual(
    similarFestivals(anchor, sameName, { locale: "en" }).map((row) => row.festival.slug),
    ["a", "b"],
  );
  const clash = { ...anchor, slug: "clash" };
  assert.equal(similarFestivals(anchor, [clash], { locale: "en" })[0].gapDays, 0);
});

test("ranks only recommendations with the same verified edition year", () => {
  const current = { ...anchor, editionYear: 2028, startDate: "2028-06-10", endDate: "2028-06-12" };
  const match = { ...current, slug: "same-year", name: "Valid edition" };
  const archive = { ...match, slug: "archive", editionYear: 2026 };
  const previous = { ...match, slug: "previous", editionYear: 2027 };
  const unknown = { ...match, slug: "unknown", editionYear: undefined };
  const options = { locale: "en" };
  const candidates = [archive, previous, unknown, match];
  assert.deepEqual(
    similarFestivals(current, candidates, options).map(({ festival }) => festival.slug),
    ["same-year"],
  );
  assert.deepEqual(
    similarFestivals({ ...current, editionYear: undefined }, candidates, options),
    [],
  );
});

for (const [language, heading] of [
  ["en", "Related festivals"],
  ["de", "Verwandte Festivals"],
  ["ru", "Связанные фестивали"],
]) {
  test(`festival trip tools show only same-season recommendations in ${language}`, () => {
    const item = {
      ...fixture,
      ...anchor,
      editionYear: 2028,
      startDate: "2028-06-10",
      endDate: "2028-06-12",
    };
    const same = { ...item, slug: "same-season", name: "Same Season Fixture" };
    const previous = {
      ...same,
      slug: "previous-season",
      name: "Previous Season Fixture",
      editionYear: 2027,
    };
    const unknown = {
      ...same,
      slug: "unknown-season",
      name: "Unknown Season Fixture",
      editionYear: undefined,
    };
    const render = (anchorEdition) =>
      renderToStaticMarkup(
        h(
          LanguageProvider,
          { initialLanguage: language },
          h(
            LocalPlannerProvider,
            null,
            h(PlanningTools, { item: anchorEdition, festivals: [same, previous, unknown] }),
          ),
        ),
      );
    const html = render(item);
    assert.ok(html.includes(heading));
    assert.match(html, /Same Season Fixture/);
    assert.doesNotMatch(html, /Previous Season Fixture|Unknown Season Fixture/);
    assert.doesNotMatch(render({ ...item, editionYear: undefined }), /class="recommendations"/);
  });
}
