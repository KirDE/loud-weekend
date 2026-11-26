import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const args of [
  ["--publish"],
  ["--record-attempt"],
  ["--record-attempt", "wrong"],
  ["--record-attempt", "abcdef123", "--publish"],
]) {
  test(`Roskilde CLI rejects ${args.join(" ")} before DB/network`, () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/collect-roskilde-stock.ts", ...args],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, DATABASE_URL: "invalid-sensitive-do-not-print" },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /invalid-sensitive/);
  });
}
test("Roskilde CLI recording requires explicit DB configuration before any request", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/collect-roskilde-stock.ts", "--record-attempt", "abcdef123"],
    {
      encoding: "utf8",
      timeout: 10000,
      env,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no verified refresh/);
});

test("Roskilde CLI default preview ignores DB configuration and prints only minimized candidate", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "roskilde-cli-"));
  try {
    const preload = join(dir, "fetch.mjs");
    const fixture = new URL("./fixtures/roskilde/tickster-products.html", import.meta.url).href;
    writeFileSync(
      preload,
      `import {readFileSync} from 'node:fs';
const html=readFileSync(new URL(${JSON.stringify(fixture)}),'utf8');
globalThis.fetch=async(url,options)=>{
 const root='https://ticket.roskilde-festival.dk/da/vgkw6td2h3rrfkv';
 if(options.method!=='GET'||!String(url).startsWith(root)) throw Error('forbidden');
 const homepage='<title>Roskilde Festival - Tickster</title><h3>Partout</h3>'
   + '<p>Alle otte dage på Roskilde Festival 2027.</p>';
 const r=new Response(String(url).endsWith('/products')?html:homepage,{
   headers:{'content-type':'text/html','set-cookie':'session=synthetic-private; Path=/; Secure'}
 });
 Object.defineProperty(r,'url',{value:String(url)}); return r;
};`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        pathToFileURL(preload).href,
        "scripts/collect-roskilde-stock.ts",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, DATABASE_URL: "invalid-sensitive-do-not-print" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "preview");
    assert.equal(output.candidate.ticketStatus, "available");
    assert.equal(output.candidate.evidence.length, 2);
    assert.doesNotMatch(result.stdout, /synthetic-private|cookie|invalid-sensitive|<html/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
