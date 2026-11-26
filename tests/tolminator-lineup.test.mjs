import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import {
  TOLMINATOR_HOME,
  TOLMINATOR_LINEUP,
  TOLMINATOR_DOCUMENTS,
} from "../lib/ingestion/adapters/tolminator.ts";
const fixture = await readFile(
  new URL("./fixtures/official-markup/tolminator-lineup-2027.html", import.meta.url),
  "utf8",
);
const names = JSON.parse(
  await readFile(
    new URL("./fixtures/official-markup/tolminator-lineup-2027-names.json", import.meta.url),
  ),
);
const source = parserSource("tolminator", { url: TOLMINATOR_HOME });
const home = '<header>28 July - 1 August 2027</header><a href="/en/lineup/">Lineup</a>';
const bundle = (lineup = fixture, front = home) =>
  JSON.stringify({ kind: TOLMINATOR_DOCUMENTS, home: front, lineup });
const parse = (doc, config = source) =>
  extractFestivalCandidate(doc, config, "2026-11-26T14:00:00Z");
test("real Tolminator heading identities, provenance and additive current-edition lineup", () => {
  const candidate = parse(bundle());
  assert.equal(names.length, 66);
  assert.deepEqual(candidate.lineup, names);
  assert.equal(candidate.artistListMode, "additive");
  assert.equal(candidate.lineupScope, "announcement");
  assert.equal(candidate.status, "partial");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.evidence.find((e) => e.field === "lineup").sourceUrl, TOLMINATOR_LINEUP);
  assert.ok(names.includes("Halls Of Oblivion"));
  assert.ok(!names.includes("Halls Of Oblivian"));
});
test("future textual additions and duplicate cards are not pinned to the current roster", () => {
  const extra =
    '<a href="/en/band/future-act/"><img src="Tolminator2027_FUTURE.jpg"><h3>Future &amp; Act</h3></a>';
  assert.deepEqual(parse(bundle(fixture + extra + extra)).lineup, [...names, "Future & Act"]);
  assert.deepEqual(
    parse(bundle(fixture + '<a href="https://foreign.test/en/band/bad/"><h3>Bad</h3></a>')).lineup,
    names,
  );
  assert.deepEqual(parse(bundle()).lineup, parse(bundle()).lineup);
});
test("foreign/missing/contradictory editions and invalid dates never propose a roster", () => {
  for (const doc of [
    bundle(fixture.replaceAll("2027", "2026")),
    bundle(fixture, home.replaceAll("2027", "2028")),
    bundle(fixture.replace("28 July - 1 August 2027", "")),
    bundle(fixture + "<p>28 July - 1 August 2026</p>"),
    bundle(fixture.replace("28 July", "32 July")),
    bundle(fixture.replace("Tolminator2027_card", "Tolminator2026_card")),
    bundle(fixture, home + "<p>29 July - 1 August 2027</p>"),
  ])
    assert.equal(parse(doc).lineup, undefined);
  assert.equal(parse(bundle(), { ...source, url: "https://foreign.test/" }).lineup, undefined);
});
test("bounded collector follows only the official listing and rejects redirect/missing link", async () => {
  const seen = [];
  const result = await fetchSource(source, {
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response(url === TOLMINATOR_HOME ? home : fixture);
    },
  });
  assert.deepEqual(seen, [TOLMINATOR_HOME, TOLMINATOR_LINEUP]);
  assert.equal(result.response.url, TOLMINATOR_HOME);
  assert.deepEqual(parse(await result.response.text()).lineup, names);
  await assert.rejects(
    fetchSource(source, { fetchImpl: async () => new Response("28 July - 1 August 2027") }),
    /link missing/,
  );
  await assert.rejects(
    fetchSource(source, {
      fetchImpl: async (url) => {
        const response = new Response(url === TOLMINATOR_HOME ? home : fixture);
        Object.defineProperty(response, "url", {
          value: url === TOLMINATOR_HOME ? url : "https://foreign.test/",
        });
        return response;
      },
    }),
    /redirected/,
  );
});

test("Tolminator additions require protected review while an unchanged replay is quiet", () => {
  const candidate = parse(bundle());
  const current = {
    slug: "tolminator",
    editionYear: 2027,
    city: "Tolmin",
    status: "partial",
    ticketStatus: "unknown",
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    headliners: [],
    lineup: [],
  };
  const initial = evaluateCandidate(current, candidate);
  assert.equal(initial.publishable, false);
  const additions = initial.changes.filter((x) => x.kind === "artist_added");
  assert.equal(additions.length, names.length);
  assert.ok(additions.every((x) => x.reviewRequired));
  assert.ok(initial.reviewReasons.some((x) => x.includes("protected ingestion review")));
  const saved = {
    ...current,
    headliners: names.slice(0, 2),
    lineup: [...names.slice(2), "Prior Saved Act"],
  };
  const replay = evaluateCandidate(saved, candidate);
  assert.deepEqual(replay.changes, []);
  assert.deepEqual(replay.reviewReasons, []);
  const extra =
    '<a href="/en/band/future-act/"><img src="Tolminator2027_FUTURE.jpg"><h3>Future &amp; Act</h3></a>';
  const later = evaluateCandidate(saved, parse(bundle(fixture + extra)));
  assert.equal(later.publishable, false);
  assert.deepEqual(
    later.changes
      .filter((x) => x.field === "lineup" || x.field === "headliners")
      .map((x) => [x.kind, x.after, x.reviewRequired]),
    [["artist_added", "Future & Act", true]],
  );
});
