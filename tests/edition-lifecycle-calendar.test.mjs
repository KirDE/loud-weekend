import { personalCalendar } from "../lib/personal-calendar.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as planning from "../lib/planning.ts";
import * as lifecycle from "../lib/edition-lifecycle.ts";
import * as language from "../components/LanguageProvider.tsx";
import { LocalPlannerProvider } from "../components/LocalPlanner.tsx";
import { FestivalViews } from "../components/FestivalViews.tsx";
import { PlanningTools } from "../components/PlanningTools.tsx";
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
  editionYear: 2027,
  officialUrl: notice.sourceUrl,
  startDate: "2027-08-25",
  endDate: "2027-08-29",
  editionLifecycle: notice,
};
const active = {
  ...festival,
  slug: "other-event",
  name: "Other Event",
  startDate: "2027-08-27",
  endDate: "2027-08-28",
};
const render = (locale, element) =>
  renderToStaticMarkup(
    h(
      language.LanguageProvider,
      { initialLanguage: locale },
      h(LocalPlannerProvider, null, element),
    ),
  );
const payload = (html) =>
  decodeURIComponent(html.match(/href="data:text\/calendar;charset=utf-8,([^"]+)"/)[1]);

test("mixed and all-paused exports never create scheduled events for a hiatus; raw facts preserved", () => {
  const before = structuredClone(paused);
  for (const items of [[paused], [active, paused], [paused, active]]) {
    const ics = planning.calendarFile(items);
    assert.doesNotMatch(ics, /rock-en-seine|20270825|20270830|Rock en Seine/);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, items.includes(active) ? 1 : 0);
    if (items.includes(active)) assert.match(ics, /DTEND;VALUE=DATE:20270829/);
  }
  assert.equal(planning.calendarEligible(paused), false);
  assert.equal(planning.calendarUrls(paused), null);
  assert.deepEqual(paused, before);
  assert.ok(planning.calendarUrls({ ...paused, editionLifecycle: undefined }));
});
test("bad dates and malformed or transferred lifecycle never advertise calendar actions", () => {
  for (const dates of [
    { startDate: undefined },
    { startDate: "2027-02-29" },
    { startDate: "2027-08-25", endDate: "2027-08-01" },
    { endDate: "broken" },
  ]) {
    const item = { ...active, ...dates };
    assert.equal(planning.calendarEligible(item), false);
    assert.equal(planning.calendarUrls(item), null);
    assert.doesNotMatch(planning.calendarFile([item]), /BEGIN:VEVENT/);
  }
  for (const item of [
    { ...paused, slug: "foreign" },
    { ...paused, editionYear: 2028 },
    { ...paused, officialUrl: "https://foreign.invalid/" },
    { ...paused, editionLifecycle: { ...notice, reviewState: "pending" } },
    { ...paused, editionLifecycle: null },
  ]) {
    for (const read of [
      planning.calendarEligible,
      planning.calendarUrls,
      (item) => planning.calendarFile([item]),
    ])
      assert.throws(() => read(item));
  }
});

// Exercise the real PlannerPage JSX with a ready saved plan (SSR provider is not hydrated).
const require = createRequire(import.meta.url);
const { code } = await transform(
  await readFile(new URL("../components/PlannerPage.tsx", import.meta.url), "utf8"),
  { loader: "tsx", jsx: "automatic", format: "cjs", target: "es2022" },
);
function readyPlanner(items, locale) {
  const preferences = {
    ready: true,
    favoriteFestivals: [paused.slug, active.slug],
    attendance: { [paused.slug]: "going" },
    playlistFestivals: items.map((f) => f.slug),
    favoriteArtists: [],
    setAttendance() {
      throw new Error("Rendering must not rewrite attendance");
    },
  };
  const before = structuredClone({ ...preferences, setAttendance: undefined });
  const deps = {
    react: require("react"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": require("next/link"),
    "@/lib/planning": planning,
    "@/lib/product-events": { sendProductEvent: () => undefined },
    "@/lib/favorite-artist": require("../lib/favorite-artist.ts"),
    "./PersonalCalendar": { PersonalCalendar: () => null },
    "@/lib/playlist-depth": require("../lib/playlist-depth.ts"),
    "@/lib/playlist-selection": require("../lib/playlist-selection.ts"),
    "./TripBudget": { TripBudget: () => null },
    "@/lib/edition-lifecycle": lifecycle,
    "./LanguageProvider": language,
    "./LocalPlanner": { useLocalPlanner: () => preferences },
    "./PlannerReset": { PlannerReset: () => null },
    "./AccountSyncPanel": { AccountSyncPanel: () => null },
    "./FestivalViews": { FestivalViews: () => null },
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
  const html = render(
    locale,
    h(module.exports.PlannerPage, {
      festivals: items,
      catalogueArtists: [
        { slug: "sample-artist", name: "Sample Artist" },
        { slug: "paused-only", name: "Paused Only Headliner" },
      ],
      lineups: {
        artistSlugsByFestival: { [active.slug]: ["sample-artist"], [paused.slug]: ["paused-only"] },
        legacyFavoriteSlugs: {},
      },
    }),
  );
  assert.deepEqual({ ...preferences, setAttendance: undefined }, before);
  return html;
}
for (const locale of ["en", "de", "ru"]) {
  test(`actual calendar view omits hiatus scheduling but preserves geographic discovery in ${locale}`, () => {
    const html = render(locale, h(FestivalViews, { festivals: [paused, active] }));
    const grid = html.match(/<div class="calendarGrid"[^]*?<\/div>/)[0];
    assert.doesNotMatch(grid, /Rock en Seine|2027-08-25/);
    assert.match(grid, /Other Event/);
    assert.doesNotMatch(payload(html), /Rock en Seine/);
    assert.match(html, /Rock en Seine/); // Map remains a geographic link, not a schedule assertion.
    const empty = render(locale, h(FestivalViews, { festivals: [paused] }));
    assert.doesNotMatch(empty, /dateTime="2027-08-25"/);
    assert.doesNotMatch(payload(empty), /BEGIN:VEVENT/);
  });
  test(`planning downloads use the edition year rather than the current season in ${locale}`, () => {
    const item = { ...active, editionYear: 2028, startDate: "2028-07-03", endDate: "2028-07-05" };
    const html = render(locale, h(PlanningTools, { item, festivals: [] }));
    assert.match(html, /download="other-event-2028\.ics"/);
    assert.match(html, /download="other-event-apple-calendar-2028\.ics"/);
    assert.match(payload(html), /UID:other-event-2028@festival-radar/);
    const withoutYear = render(
      locale,
      h(PlanningTools, { item: { ...item, editionYear: undefined }, festivals: [] }),
    );
    assert.match(withoutYear, /download="other-event\.ics"/);
  });
  test(`actual planning tools suppress calendar/timetable and do not promise a pending date in ${locale}`, () => {
    const html = render(locale, h(PlanningTools, { item: paused, festivals: [paused, active] }));
    assert.ok(html.includes(language.translate(locale, "editionHiatus")));
    assert.doesNotMatch(html, /data:text\/calendar|calendar.google.com|timetable/);
    const normal = render(
      locale,
      h(PlanningTools, { item: { ...paused, editionLifecycle: undefined }, festivals: [active] }),
    );
    assert.match(normal, /data:text\/calendar/);
    assert.match(normal, /timetable/);
  });
  test(
    `actual ready planner keeps saved hiatus preferences without old ` +
      `dates or calendar download in ${locale}`,
    () => {
      const html = readyPlanner([paused], locale);
      assert.match(html, /Rock en Seine/);
      assert.ok(html.includes(language.translate(locale, "editionHiatus")));
      assert.doesNotMatch(html, /2027-08-25|data:text\/calendar/);
      assert.doesNotMatch(html, /<select[^>]*disabled=""/);
      assert.match(html, /<option value=""[^>]*>/);
      assert.match(html, /<option value="going" disabled="" selected=""/);
      const mixed = readyPlanner([paused, active], locale);
      assert.doesNotMatch(payload(mixed), /Rock en Seine|20270825/);
      assert.match(payload(mixed), /Other Event/);
    },
  );
}

for (const locale of ["en", "de", "ru"])
  test(`review regression: planner playlist excludes paused rosters but preserves selection in ${locale}`, () => {
    const stale = {
      ...paused,
      headliners: ["Paused Only Headliner"],
      lineup: ["Paused Only Support"],
    };
    const empty = readyPlanner([stale], locale);
    assert.doesNotMatch(empty, /data:text\/plain|Paused Only|selection-playlist/);
    assert.match(empty, /type="checkbox" checked=""/);
    const mixed = readyPlanner([stale, active], locale);
    const exported = decodeURIComponent(
      mixed.match(/href="data:text\/plain;charset=utf-8,([^"]+)"/)[1],
    );
    assert.equal(exported, "Sample Artist");
    assert.doesNotMatch(mixed, /Paused Only/);
    assert.equal(
      (mixed.match(/<div class="playlistFestivalGrid">(.*?)<\/div>/)[1].match(/checked=""/g) || [])
        .length,
      2,
    );
  });

test("an approved hiatus cannot create a personal-calendar conflict or erase attendance", () => {
  const current = { ...active, startDate: paused.startDate, endDate: paused.endDate };
  const attendance = Object.freeze({ [paused.slug]: "going", [current.slug]: "maybe" });
  assert.equal(
    personalCalendar([{ ...paused, editionLifecycle: undefined }, current], attendance).conflicts
      .length,
    1,
  );
  assert.deepEqual(personalCalendar([paused, current], attendance), {
    dated: [current],
    undated: [],
    conflicts: [],
  });
  assert.equal(attendance[paused.slug], "going");
});
