import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { checkIndexing, inspectSitemap } from "../scripts/check-indexing.mjs";

const site = "https://loudweekend.eu";
const languages = ["x-default", "en", "de", "ru"];

function cluster(path, targets = Object.fromEntries(languages.map(lang => [lang, lang === "x-default" ? path : `/${lang}${path}`]))) {
  const links = languages.map(lang =>
    `<xhtml:link rel="alternate" hreflang="${lang}" href="${site}${targets[lang]}"/>`,
  ).join("");
  return Object.values(targets).map(target => `<url><loc>${site}${target}</loc>${links}</url>`).join("");
}

const sitemap = contents =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${contents}</urlset>`;

test("accepts reciprocal alternate links to the same page in the declared languages", () => {
  const urls = sitemap(cluster("/") + cluster("/festivals/synthetic/") + cluster("/artists/synthetic/"));
  assert.equal(inspectSitemap(urls).size, 12);
});

test("rejects reciprocal alternate links whose language targets are swapped", () => {
  const urls = sitemap(cluster("/", { "x-default": "/", en: "/de/", de: "/en/", ru: "/ru/" }));
  assert.throws(() => inspectSitemap(urls), /incorrect hreflang en/);
});

test("rejects a reciprocal cluster that points to a different festival in another language", () => {
  const urls = sitemap(cluster("/") + cluster("/festivals/synthetic/", {
    "x-default": "/festivals/synthetic/",
    en: "/en/festivals/synthetic/",
    de: "/de/festivals/different/",
    ru: "/ru/festivals/synthetic/",
  }));
  assert.throws(() => inspectSitemap(urls), /incorrect hreflang de/);
});

test("the HTTP smoke check validates crawl access and indexing directives", async (t) => {
  const clusterPaths = ["/", "/festivals/synthetic/", "/festivals/unsampled/", "/artists/synthetic/"];
  const otherPaths = ["/submit/", "/archive/", "/festivals/synthetic/2027/", "/editions/2027/", "/countries/de/", "/months/07/"];
  const xml = sitemap(clusterPaths.map(path => cluster(path)).join("") +
    otherPaths.map(path => `<url><loc>${site}${path}</loc></url>`).join(""));
  const entries = inspectSitemap(xml);
  const openRobots = `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`;
  let robotsBody = openRobots;
  let robotsHeader;
  let robotsMeta = '<meta name="robots" content="index, max-image-preview:none">';
  let wrapCanonical = false;
  let wrapAlternates = false;
  const server = createServer((request, response) => {
    const path = request.url;
    if (path === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" }).end(robotsBody);
    } else if (path === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" }).end(xml);
    } else if (entries.has(path)) {
      const lang = /^\/(en|de|ru)\//.exec(path)?.[1] ?? "en";
      const links = [...entries.get(path)].map(([code, target]) =>
        `<link rel="alternate" hreflang="${code}" href="${site}${target}">`).join("");
      if (path === "/de/" && robotsHeader) response.setHeader("X-Robots-Tag", robotsHeader);
      const canonical = `<link rel="canonical" href="${site}${path}">`;
      const metadata = (value, wrap) => wrap && path === "/de/" ? `<template>${value}</template>` : value;
      response.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><html lang="${lang}"><head>${metadata(canonical, wrapCanonical)}${metadata(links, wrapAlternates)}${path === "/de/" ? robotsMeta : ""}</head></html>`);
    } else {
      response.writeHead(404).end();
    }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await t.test("allows pages that only suppress the image preview", async () => {
    assert.deepEqual(await checkIndexing(origin), { entries: 22, sampled: 18 });
  });
  await t.test("requires canonical and alternate links outside inert templates", async () => {
    try {
      wrapCanonical = true;
      await assert.rejects(checkIndexing(origin), /expected a single canonical on \/de\//);
      wrapCanonical = false;
      wrapAlternates = true;
      await assert.rejects(checkIndexing(origin), /missing\/duplicate x-default alternate on \/de\//);
    } finally {
      wrapCanonical = false;
      wrapAlternates = false;
    }
  });
  await t.test("ignores robots directives inside inert templates", async () => {
    const previous = robotsMeta;
    try {
      robotsMeta += '<template><meta name="robots" content="noindex"></template>';
      assert.deepEqual(await checkIndexing(origin), { entries: 22, sampled: 18 });
    } finally {
      robotsMeta = previous;
    }
  });
  await t.test("rejects crawler access regressions for sampled public routes", async () => {
    for (const [rules, expected] of [
      ["Disallow: /*", /robots\.txt blocks Googlebot on \/sitemap\.xml/],
      ["Disallow: /festivals/", /robots\.txt blocks Googlebot on \/festivals\/synthetic\//],
      ["Allow: /\n\nUser-agent: Bingbot\nDisallow: /de/", /robots\.txt blocks Bingbot on \/de\//],
    ]) {
      robotsBody = `User-agent: *\n${rules}\nSitemap: ${site}/sitemap.xml\n`;
      await assert.rejects(checkIndexing(origin), expected);
    }
    robotsBody = openRobots;
  });
  await t.test("rejects robots restrictions on sitemap URLs outside the HTTP sample", async () => {
    robotsBody = `User-agent: *\nDisallow: /de/festivals/unsampled/\nSitemap: ${site}/sitemap.xml\n`;
    try {
      await assert.rejects(checkIndexing(origin), /robots\.txt blocks Googlebot on \/de\/festivals\/unsampled\//);
    } finally {
      robotsBody = openRobots;
    }
  });
  await t.test("does not accept a sitemap declaration without the expected default crawler group", async () => {
    robotsBody = `Sitemap: ${site}/sitemap.xml\n`;
    await assert.rejects(checkIndexing(origin), /missing default robots.txt group/);
    robotsBody = openRobots;
  });
  await t.test("allows unrelated crawler blocks and more specific public exceptions", async () => {
    robotsBody = `User-agent: *\nDisallow: /api/\nDisallow: /de/\nAllow: /de/\n\nUser-agent: ExampleBot\nDisallow: /\nSitemap: ${site}/sitemap.xml\n`;
    assert.deepEqual(await checkIndexing(origin), { entries: 22, sampled: 18 });
    robotsBody = openRobots;
  });
  await t.test("allows response headers that only suppress image previews", async () => {
    for (const header of ["max-image-preview: none", "Googlebot: MAX-IMAGE-PREVIEW:none, nofollow"]) {
      robotsHeader = header;
      assert.deepEqual(await checkIndexing(origin), { entries: 22, sampled: 18 });
    }
  });
  await t.test("rejects bare and crawler-scoped HTTP indexing blocks", async () => {
    for (const header of ["NOINDEX", "googlebot: None", ["max-image-preview:none", "bingbot: noindex, nofollow"]]) {
      robotsHeader = header;
      await assert.rejects(checkIndexing(origin), /X-Robots-Tag disallows indexing/);
    }
    robotsHeader = undefined;
  });
  await t.test("rejects mixed-case crawler names and directives", async () => {
    for (const name of ["Robots", "GoogleBot", "BingBot"]) {
      robotsMeta = `<meta name="${name}" content="nofollow, NOINDEX">`;
      await assert.rejects(checkIndexing(origin), /not indexable: \/de\//);
    }
  });
});
