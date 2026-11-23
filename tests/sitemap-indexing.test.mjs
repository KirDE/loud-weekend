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

test("the HTTP smoke check distinguishes crawler noindex from image preview restrictions", async (t) => {
  const clusterPaths = ["/", "/festivals/synthetic/", "/artists/synthetic/"];
  const otherPaths = [
    "/submit/",
    "/archive/",
    "/festivals/synthetic/2027/",
    "/editions/2027/",
    "/countries/de/",
    "/months/07/",
  ];
  const xml = sitemap(
    clusterPaths.map((path) => cluster(path)).join("") +
      otherPaths.map((path) => `<url><loc>${site}${path}</loc></url>`).join(""),
  );
  const entries = inspectSitemap(xml);
  let robotsMeta = '<meta name="robots" content="index, max-image-preview:none">';
  const server = createServer((request, response) => {
    const path = request.url;
    if (path === "/robots.txt") {
      response
        .writeHead(200, { "content-type": "text/plain" })
        .end(`Sitemap: ${site}/sitemap.xml\n`);
    } else if (path === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" }).end(xml);
    } else if (entries.has(path)) {
      const lang = /^\/(en|de|ru)\//.exec(path)?.[1] ?? "en";
      const links = [...entries.get(path)]
        .map(
          ([code, target]) => `<link rel="alternate" hreflang="${code}" href="${site}${target}">`,
        )
        .join("");
      const head = [
        `<link rel="canonical" href="${site}${path}">`,
        links,
        path === "/de/" ? robotsMeta : "",
      ].join("");
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html><html lang="${lang}"><head>${head}</head></html>`);
    } else {
      response.writeHead(404).end();
    }
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await t.test("allows pages that only suppress the image preview", async () => {
    assert.deepEqual(await checkIndexing(origin), { entries: 18, sampled: 18 });
  });
  await t.test("rejects mixed-case crawler names and directives", async () => {
    for (const name of ["Robots", "GoogleBot", "BingBot"]) {
      robotsMeta = `<meta name="${name}" content="nofollow, NOINDEX">`;
      await assert.rejects(checkIndexing(origin), /not indexable: \/de\//);
    }
  });
});
