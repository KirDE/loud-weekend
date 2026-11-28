import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalLocationMap } from "../components/FestivalLocationMap.tsx";
import { LanguageProvider } from "../components/LanguageProvider.tsx";
import { festival } from "./support/catalog.ts";

for (const language of ["en", "de", "ru"]) {
  test(`the ${language} map list links to the displayed editions and handles unknown years`, () => {
    const festivals = [
      { ...festival, slug: "archived", editionYear: 2026, coordinates: undefined },
      { ...festival, slug: "future", editionYear: 2028, coordinates: undefined },
      { ...festival, slug: "unknown", editionYear: undefined, coordinates: undefined },
    ];
    const markup = renderToStaticMarkup(
      createElement(
        LanguageProvider,
        { initialLanguage: language },
        createElement(FestivalLocationMap, { festivals }),
      ),
    );
    assert.deepEqual(
      [...markup.matchAll(/href="(\/festivals\/[^"]+)"/g)].map((match) =>
        match[1].replace(/\/$/, ""),
      ),
      ["/festivals/archived/2026", "/festivals/future/2028", "/festivals/unknown"],
    );
  });
}
