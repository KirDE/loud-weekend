import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { transform } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider, useLanguage } from "../components/LanguageProvider.tsx";
import * as dates from "../lib/festival-dates.ts";
import * as calendar from "../lib/personal-calendar.ts";
import * as planning from "../lib/planning.ts";
import { festival } from "./support/catalog.ts";

const festivals = [
  {
    ...festival,
    slug: "summer",
    editionYear: 2028,
    startDate: "2028-06-10",
    endDate: "2028-06-12",
  },
  {
    ...festival,
    slug: "weekender",
    editionYear: 2027,
    startDate: "2028-06-11",
    endDate: "2028-06-13",
  },
  {
    ...festival,
    slug: "dates-pending",
    editionYear: 2028,
    startDate: undefined,
    endDate: undefined,
  },
  {
    ...festival,
    slug: "year-pending",
    editionYear: undefined,
    startDate: undefined,
    endDate: undefined,
  },
];
const attendance = Object.fromEntries(festivals.map(({ slug }) => [slug, "going"]));
const require = createRequire(import.meta.url);
const { code } = await transform(
  await readFile(new URL("../components/PersonalCalendar.tsx", import.meta.url), "utf8"),
  { loader: "tsx", jsx: "automatic", format: "cjs" },
);
const deps = {
  "react/jsx-runtime": require("react/jsx-runtime"),
  "next/link": require("next/link"),
  "@/lib/festival-dates": dates,
  "@/lib/personal-calendar": calendar,
  "@/lib/planning": planning,
  "./LanguageProvider": { useLanguage },
  "./LocalPlanner": {
    useLocalPlanner: () => ({ attendance, editionAttendance: (slug) => attendance[slug] }),
  },
};
const module = { exports: {} };
new Function("require", "module", "exports", code)(
  (id) => {
    assert.ok(Object.hasOwn(deps, id), id);
    return deps[id];
  },
  module,
  module.exports,
);

for (const language of ["en", "de", "ru"]) {
  test(`personal calendar links use the persisted year in every list (${language})`, () => {
    const html = renderToStaticMarkup(
      h(
        LanguageProvider,
        { initialLanguage: language },
        h(module.exports.PersonalCalendar, { festivals }),
      ),
    );
    const links = [...html.matchAll(/href="(\/festivals\/[^"]+)"/g)].map(([, href]) =>
      href.replace(/\/$/, ""),
    );
    assert.deepEqual(links, [
      "/festivals/summer/2028",
      "/festivals/weekender/2027",
      "/festivals/summer/2028",
      "/festivals/weekender/2027",
      "/festivals/dates-pending/2028",
      "/festivals/year-pending",
    ]);
  });
}
