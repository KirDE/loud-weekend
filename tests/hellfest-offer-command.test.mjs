import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArguments, runCollection } from "../scripts/collect-hellfest-offers.mjs";
const html = readFileSync(new URL("./fixtures/hellfest/offer-cards.html", import.meta.url), "utf8");
const response = (body = html, status = 200) => {
  const r = new Response(body, { status, headers: { "content-type": "text/html" } });
  Object.defineProperty(r, "url", { value: "https://hellfest.fr/" });
  return r;
};
test("strict explicit CLI modes reject typo/duplicate/override args before any work", async () => {
  for (const args of [
    [],
    ["--year=2027", "--year=2027"],
    ["--year=2027", "--apply"],
    ["--year=2027", "--approve"],
    ["--year=2027", "--stage-pending"],
    ["--year=2027", "--edition-id=x"],
    ["--year=2027", "--url=https://other.invalid"],
    ["--year=bad"],
    ["--year=2027", "--stage-pending", "--edition-id=../x"],
    ["--help", "--year=2027"],
  ]) {
    let called = false;
    await assert.rejects(
      runCollection(args, {
        fetchImpl: async () => {
          called = true;
          return response();
        },
      }),
    );
    assert.equal(called, false);
  }
  assert.deepEqual(parseArguments(["--year=2027"]), {
    year: 2027,
    editionId: undefined,
    stage: false,
  });
});
test("preview performs one strict public GET and never touches injected DB", async () => {
  let calls = 0;
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error("Preview touched DB");
      },
    },
  );
  const result = await runCollection(["--year=2027"], {
    db,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://hellfest.fr/");
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "omit");
      return response();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.mode, "preview");
  assert.equal(result.writes, false);
  assert.deepEqual(
    result.proposal.offers.map((o) => o.status),
    ["sold_out", "not_on_sale"],
  );
  for (const fetchImpl of [
    async () => response(html, 403),
    async () => response("changed schema"),
    async () => response(html.replaceAll("2027", "2026")),
  ]) {
    await assert.rejects(runCollection(["--year=2027"], { db, fetchImpl }));
  }
});
test("staging needs explicit DB and validates persisted target before public GET", async () => {
  const args = ["--year=2027", "--stage-pending", "--edition-id=target"];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response();
  };
  await assert.rejects(runCollection(args, { fetchImpl }));
  const valid = {
    year: 2027,
    recordState: "CURRENT",
    festival: { slug: "hellfest", officialUrl: "https://hellfest.fr/" },
  };
  for (const edition of [
    null,
    { ...valid, year: 2026 },
    { ...valid, recordState: "ARCHIVED" },
    { ...valid, festival: { ...valid.festival, slug: "other" } },
    { ...valid, festival: { ...valid.festival, officialUrl: "https://other.invalid/" } },
  ]) {
    await assert.rejects(
      runCollection(args, {
        db: { festivalEdition: { findUnique: async () => edition } },
        fetchImpl,
      }),
    );
  }
  assert.equal(calls, 0);
});
test("actual CLI help/invalid/missing DB are bounded, offline and redact environment secrets", () => {
  for (const [args, status] of [
    [["--help"], 0],
    [["--approve"], 1],
    [["--year=2027", "--stage-pending", "--edition-id=x"], 1],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/collect-hellfest-offers.mjs", ...args],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, DATABASE_URL: "", SECRET_TEST: "never-print-synthetic-secret" },
      },
    );
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /never-print-synthetic-secret|postgresql:\/\//,
    );
    if (!status) assert.match(result.stdout, /read-only preview/);
    else assert.match(result.stderr, /hellfest_collection_failed/);
  }
});
