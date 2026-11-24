import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const saved = JSON.parse(
  readFileSync(
    new URL("./fixtures/official-markup/heavy-weekend-reviewed.json", import.meta.url),
    "utf8",
  ),
);
const base = JSON.parse(
  readFileSync(
    new URL("./fixtures/official-markup/heavy-weekend-linked-2027.json", import.meta.url),
    "utf8",
  ),
);
const detail = readFileSync(
  new URL("./fixtures/official-markup/heavy-compound-slash.html", import.meta.url),
  "utf8",
);
const source = {
  festivalSlug: "heavy-weekend",
  url: "https://www.heavyweekend.live/",
  editionYear: 2027,
  strategies: ["official_markup"],
  enabled: true,
  refreshPolicy: "weekly",
};
const parse = (html = detail) => {
  const e = structuredClone(base);
  e.documents.find((d) => d.url.endsWith("/slash")).html = html;
  return extractFestivalCandidate(JSON.stringify(e), source, "2026-11-17T19:31:00Z");
};

const logo = readFileSync(
  new URL("./fixtures/official-markup/heavy-slash-logo.png", import.meta.url),
);
const credit = "SLASH featuring MYLES KENNEDY AND THE CONSPIRATORS";
test("reviewed official logo identifies existing compound billing without a duplicate or removals", () => {
  const c = parse();
  assert.ok(c.lineup.includes(credit));
  assert.ok(!c.lineup.includes("SLASH"));
  assert.deepEqual(c.warnings, []);
  const r = evaluateCandidate(saved, c);
  assert.ok(!r.changes.some((d) => /slash/i.test(d.after ?? "")));
  assert.ok(!r.changes.some((d) => d.kind.endsWith("_removed")));
  assert.equal(r.publishable, false);
  assert.ok(
    r.reviewReasons.includes("Agent review required before lineup-triggered provider activity"),
  );
});
test("biography is not billing: removing or arbitrarily rewriting it cannot change the reviewed identity", () => {
  for (const bio of [
    "",
    "<p>Son ancien EP <strong>SLASH FT FERGIE</strong> est une collaboration historique.</p>",
    "<p>Any future prose or conflicting name.</p>",
  ]) {
    const c = parse(detail.replace(/<div[\s\S]*?<\/div>/, bio));
    assert.ok(c.lineup.includes(credit));
    assert.ok(!c.lineup.some((n) => /Fergie/i.test(n)));
  }
});
test("changed year, heading, logo identity or absent/unverified bytes fail closed", () => {
  for (const mutate of [
    (d) => (d.html = d.html.replaceAll("2027", "2026")),
    (d) => (d.html = d.html.replaceAll("SLASH au", "Other au")),
    (d) => (d.html = d.html.replace("image-576655501", "other")),
    (d) => (d.html = d.html.replace("band-SLASH.png", "other.png")),
    (d) => delete d.logo,
    (d) => (d.logo.sha256 = "0".repeat(64)),
    (d) => (d.logo.url = "https://evil.invalid/logo.png"),
    (d) => (d.html += d.html.match(/<img[^>]+>/)[0]),
    (d) => (d.html = d.html.replace("<img ", "<img hidden ")),
  ]) {
    const e = structuredClone(base);
    mutate(e.documents.find((d) => d.url.endsWith("/slash")));
    assert.deepEqual(
      extractFestivalCandidate(JSON.stringify(e), source, "2026-11-17T22:00:00Z").evidence,
      [],
    );
  }
});
test("short labeled homepage card cannot bypass evidence by omitting linked documents", () => {
  const e = structuredClone(base);
  e.home = e.home.replace(/(href="\/line-up\/slash"[^>]*>[\s\S]*?alt=")"/, '$1SLASH"');
  assert.deepEqual(extractFestivalCandidate(e.home, source, "2026-11-17T22:00:00Z").evidence, []);
});
test("live fetch hashes actual logo bytes; corruption retains review, exact asset URL only", async () => {
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  for (const corrupt of [false, true]) {
    const calls = [];
    const r = await fetchSource(source, {
      maxAttempts: 1,
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === source.url) return new Response(base.home);
        if (url === base.documents.find((d) => d.logo)?.logo.url)
          return new Response(corrupt ? "changed bytes" : logo);
        return new Response(base.documents.find((d) => d.url === url).html);
      },
    });
    const c = extractFestivalCandidate(await r.response.text(), source, "2026-11-17T22:00:00Z");
    if (corrupt) assert.deepEqual(c.evidence, []);
    else assert.ok(c.lineup.includes(credit));
    assert.equal(calls.filter((u) => u.includes("cdn.prod")).length, 1);
  }
});
test("logo HTTP, redirect, oversized body and body-read failures preserve request accounting", async () => {
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  for (const mode of ["http", "redirect", "size", "body", "network"]) {
    let calls = 0;
    const task = () =>
      fetchSource(source, {
        maxAttempts: 1,
        fetchImpl: async (url) => {
          calls++;
          if (url === source.url) return new Response(base.home);
          if (url.includes("cdn.prod")) {
            if (mode === "network") throw new Error("offline");
            if (mode === "http") return new Response("blocked", { status: 403 });
            if (mode === "body")
              return new Response(
                new ReadableStream({
                  start(c) {
                    c.error(new Error("body failed"));
                  },
                }),
              );
            const r = new Response(mode === "size" ? new Uint8Array(256001) : logo);
            if (mode === "redirect")
              Object.defineProperty(r, "url", { value: "https://evil.invalid/logo" });
            return r;
          }
          return new Response(base.documents.find((d) => d.url === url).html);
        },
      });
    if (mode === "http") {
      const r = await task();
      assert.equal(r.response.status, 403);
      assert.equal(r.attempts, calls);
    } else
      await assert.rejects(task, (error) => {
        assert.equal(error.attempts, calls);
        return true;
      });
  }
});

test("detail transport failures retain preceding homepage and detail request attempts", async () => {
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  let calls = 0;
  await assert.rejects(
    fetchSource(source, {
      maxAttempts: 3,
      sleep: async () => {},
      fetchImpl: async (url) => {
        calls++;
        if (url === source.url) return new Response(base.home);
        if (url === base.documents[1].url) throw new Error("detail unavailable");
        return new Response(base.documents.find((d) => d.url === url).html);
      },
    }),
    (error) => {
      assert.equal(calls, 5);
      assert.equal(error.attempts, 5);
      return true;
    },
  );
});

test("detail response body failures retain all completed header-level request attempts", async () => {
  const { fetchSource } = await import("../lib/ingestion/fetch.ts");
  for (const index of [0, 1]) {
    let calls = 0;
    await assert.rejects(
      fetchSource(source, {
        maxAttempts: 1,
        fetchImpl: async (url) => {
          calls++;
          if (url === source.url) return new Response(base.home);
          if (url === base.documents[index].url)
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("detail body unavailable"));
                },
              }),
            );
          return new Response(base.documents.find((d) => d.url === url).html);
        },
      }),
      (error) => {
        assert.equal(calls, 2 + index);
        assert.equal(error.attempts, 2 + index);
        return true;
      },
    );
  }
});
