import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { PlanningTools } from "../components/PlanningTools.tsx";
import { festival } from "./support/catalog.ts";

const item = { ...festival, slug: "anchor", editionYear: 2028, genres: ["Doom Metal"] };
const discoveryLineups = {
  artistSlugsByFestival: { anchor: ["shared-act"], related: ["shared-act"] },
};
const recommendation = {
  ...item,
  slug: "related",
  name: "Related Festival",
  startDate: "2028-06-10",
  endDate: "2028-06-12",
};

for (const locale of ["en", "de", "ru"]) {
  function render(candidate) {
    return renderToStaticMarkup(
      h(
        LanguageProvider,
        { initialLanguage: locale },
        h(
          LocalPlannerProvider,
          null,
          h(PlanningTools, { item, festivals: [candidate], discoveryLineups }),
        ),
      ),
    );
  }

  test(`related festival links use the persisted edition year in ${locale}`, () => {
    const html = render(recommendation);
    assert.ok(html.includes(`href="/${locale}/festivals/related/2028"`));
    assert.ok(!html.includes(`href="/${locale}/festivals/related"`));
  });

  test(`related festival links do not infer an edition from event dates in ${locale}`, () => {
    const html = render({ ...recommendation, editionYear: undefined });
    assert.ok(html.includes(`href="/${locale}/festivals/related"`));
    assert.ok(!html.includes(`href="/${locale}/festivals/related/2028"`));
  });
}
