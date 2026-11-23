import assert from "node:assert/strict";
import test from "node:test";
import { inspectSitemap } from "../scripts/check-indexing.mjs";

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
