import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { checkIndexing, inspectSitemap } from "../scripts/check-indexing.mjs";

const site = "https://loudweekend.eu";
const languages = ["x-default", "en", "de", "ru"];

function cluster(
  path,
  targets = Object.fromEntries(
    languages.map((lang) => [lang, lang === "x-default" ? path : `/${lang}${path}`]),
  ),
) {
  const links = languages
    .map(
      (lang) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${site}${targets[lang]}"/>`,
    )
    .join("");
  return Object.values(targets)
    .map((target) => `<url><loc>${site}${target}</loc>${links}</url>`)
    .join("");
}

const sitemap = (contents) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
  `xmlns:xhtml="http://www.w3.org/1999/xhtml">${contents}</urlset>`;

test("accepts reciprocal alternate links to the same page in the declared languages", () => {
  const urls = sitemap(
    cluster("/") + cluster("/festivals/synthetic/") + cluster("/artists/synthetic/"),
  );
  assert.equal(inspectSitemap(urls).size, 12);
});

test("rejects reciprocal alternate links whose language targets are swapped", () => {
  const urls = sitemap(cluster("/", { "x-default": "/", en: "/de/", de: "/en/", ru: "/ru/" }));
  assert.throws(() => inspectSitemap(urls), /incorrect hreflang en/);
});

test("rejects a reciprocal cluster that points to a different festival in another language", () => {
  const urls = sitemap(
    cluster("/") +
      cluster("/festivals/synthetic/", {
        "x-default": "/festivals/synthetic/",
        en: "/en/festivals/synthetic/",
        de: "/de/festivals/different/",
        ru: "/ru/festivals/synthetic/",
      }),
  );
  assert.throws(() => inspectSitemap(urls), /incorrect hreflang de/);
});

test("the HTTP smoke check validates crawl access and indexing directives", async (t) => {
  const clusterPaths = [
    "/",
    "/festivals/synthetic/",
    "/festivals/unsampled/",
    "/artists/synthetic/",
    "/editions/2027/",
  ];
  const otherPaths = [
    "/submit/",
    "/archive/",
    "/festivals/synthetic/2027/",
    "/browse/",
    ...languages.slice(1).flatMap((lang) => [`/${lang}/about/`, `/${lang}/faq/`]),
    "/countries/de/",
    "/months/07/",
  ];
  const xml = sitemap(
    clusterPaths.map((path) => cluster(path)).join("") +
      otherPaths.map((path) => `<url><loc>${site}${path}</loc></url>`).join(""),
  );
  const entries = inspectSitemap(xml);
  const openRobots = `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`;
  let sitemapBody = xml;
  let robotsBody = openRobots;
  let robotsHeader;
  let robotsMeta = '<meta name="robots" content="index, max-image-preview:none">';
  let wrapCanonical = false;
  let wrapAlternates = false;
  let bodyLinks = "";
  const server = createServer((request, response) => {
    const path = request.url;
    if (path === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" }).end(robotsBody);
    } else if (path === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" }).end(sitemapBody);
    } else if (entries.has(path)) {
      if (path === "/de/" && robotsHeader) response.setHeader("X-Robots-Tag", robotsHeader);
      const lang = /^\/(en|de|ru)\//.exec(path)?.[1] ?? "en";
      const links = [...entries.get(path)]
        .map(
          ([code, target]) => `<link rel="alternate" hreflang="${code}" href="${site}${target}">`,
        )
        .join("");
      const metadata = (value, wrap) =>
        wrap && path === "/de/" ? `<template>${value}</template>` : value;
      const canonical = `<link rel="canonical" href="${site}${path}">`;
      const misplaced = path === "/de/" ? bodyLinks : "";
      const body = misplaced === "canonical" ? canonical : misplaced === "alternate" ? links : "";
      const head = [
        misplaced === "canonical" ? "" : metadata(canonical, wrapCanonical),
        misplaced === "alternate" ? "" : metadata(links, wrapAlternates),
        path === "/de/" ? robotsMeta : "",
      ].join("");
      const navigation = path.endsWith("/editions/2027/")
        ? '<main class="directoryPage"><a href="/archive/">Festival archive</a></main>'
        : "";
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          `<!doctype html><html lang="${lang}"><head>${head}</head><body>${navigation}${body}</body></html>`,
        );
    } else {
      response.writeHead(404).end();
    }
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await t.test("allows pages that only suppress the image preview", async () => {
    assert.deepEqual(await checkIndexing(origin), { entries: 32, sampled: 23 });
  });
  await t.test("rejects unsupported routes even when robots.txt allows them", async () => {
    try {
      sitemapBody = xml.replace("</urlset>", `<url><loc>${site}/planner/</loc></url></urlset>`);
      await assert.rejects(checkIndexing(origin), /unsupported sitemap path: \/planner\//);
    } finally {
      sitemapBody = xml;
    }
  });
  await t.test("requires canonical and alternate links outside inert templates", async () => {
    try {
      wrapCanonical = true;
      await assert.rejects(checkIndexing(origin), /expected a single canonical on \/de\//);
      wrapCanonical = false;
      wrapAlternates = true;
      await assert.rejects(
        checkIndexing(origin),
        /missing\/duplicate x-default alternate on \/de\//,
      );
    } finally {
      wrapCanonical = false;
      wrapAlternates = false;
    }
  });
  await t.test("does not count canonical or hreflang links in the document body", async () => {
    try {
      bodyLinks = "canonical";
      await assert.rejects(checkIndexing(origin), /expected a single canonical on \/de\//);
      bodyLinks = "alternate";
      await assert.rejects(
        checkIndexing(origin),
        /missing\/duplicate x-default alternate on \/de\//,
      );
    } finally {
      bodyLinks = "";
    }
  });
  await t.test("ignores robots directives inside inert templates", async () => {
    const previous = robotsMeta;
    try {
      robotsMeta += '<template><meta name="robots" content="noindex"></template>';
      assert.deepEqual(await checkIndexing(origin), { entries: 32, sampled: 23 });
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
      await assert.rejects(
        checkIndexing(origin),
        /robots\.txt blocks Googlebot on \/de\/festivals\/unsampled\//,
      );
    } finally {
      robotsBody = openRobots;
    }
  });
  await t.test(
    "does not accept a sitemap declaration without the expected default crawler group",
    async () => {
      robotsBody = `Sitemap: ${site}/sitemap.xml\n`;
      await assert.rejects(checkIndexing(origin), /missing default robots.txt group/);
      robotsBody = openRobots;
    },
  );
  await t.test("allows unrelated crawler blocks and more specific public exceptions", async () => {
    robotsBody = [
      "User-agent: *",
      "Disallow: /api/",
      "Disallow: /de/",
      "Allow: /de/",
      "",
      "User-agent: ExampleBot",
      "Disallow: /",
      `Sitemap: ${site}/sitemap.xml`,
      "",
    ].join("\n");
    assert.deepEqual(await checkIndexing(origin), { entries: 32, sampled: 23 });
    robotsBody = openRobots;
  });
  await t.test("allows response headers that only suppress image previews", async () => {
    for (const header of [
      "max-image-preview: none",
      "Googlebot: MAX-IMAGE-PREVIEW:none, nofollow",
    ]) {
      robotsHeader = header;
      assert.deepEqual(await checkIndexing(origin), { entries: 32, sampled: 23 });
    }
  });
  await t.test("rejects bare and crawler-scoped HTTP indexing blocks", async () => {
    for (const header of [
      "NOINDEX",
      "googlebot: None",
      ["max-image-preview:none", "bingbot: noindex, nofollow"],
    ]) {
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
