import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";

const site = "https://loudweekend.eu";
const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
const languages = ["x-default", "en", "de", "ru"];

// A header may scope a rule to a crawler. Image preview limits also use
// a colon, but "none" in that value position is not an indexing directive.
const noIndexHeader = /(?:^|,)\s*(?:(?!max-image-preview\s*:)[\w-]+\s*:\s*)?(?:noindex|none)\s*(?:,|$)/i;

async function get(origin, path, mime, limit) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "LoudWeekendIndexingCheck/1.0" },
  });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (response.status !== 200 || !mime.includes(type) || !response.body) {
    await response.body?.cancel();
    throw new Error(`${path}: expected HTTP 200 and ${mime.join(" or ")}, got ${response.status} ${type ?? ""}`);
  }
  if (noIndexHeader.test(response.headers.get("x-robots-tag") ?? "")) {
    await response.body.cancel();
    throw new Error(`${path}: X-Robots-Tag disallows indexing`);
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let result = "", size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) return result + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`${path}: oversized indexing response`);
    }
    result += decoder.decode(value, { stream: true });
  }
}

export function inspectSitemap(xml, now = Date.now()) {
  const $ = load(xml, { xml: true });
  const root = $.root().children();
  assert.equal(root.length, 1, "expected one sitemap root");
  assert.equal(root.get(0)?.name, "urlset");
  assert.equal(root.attr("xmlns"), namespace);
  assert.equal(root.attr("xmlns:xhtml"), "http://www.w3.org/1999/xhtml");
  assert.ok(xml.trimEnd().endsWith("</urlset>"), "unclosed sitemap");
  const entries = new Map();
  const urls = root.children();
  assert.ok(urls.length > 0 && urls.length <= 50_000, "invalid sitemap entry count");
  const canonicalPath = (value) => {
    const url = new URL(value);
    assert.equal(value, site + url.pathname, "expected a public canonical URL without parameters");
    assert.ok(url.pathname.endsWith("/"), `missing trailing slash: ${url.pathname}`);
    return url.pathname;
  };
  for (const node of urls) {
    assert.equal(node.name, "url");
    const entry = $(node);
    assert.equal(entry.children("loc").length, 1);
    const path = canonicalPath(entry.children("loc").text());
    assert.ok(!entries.has(path), `duplicate sitemap path: ${path}`);
    const timestamps = entry.children("lastmod");
    assert.ok(timestamps.length <= 1, `duplicate lastmod on ${path}`);
    if (timestamps.length) {
      const stamp = timestamps.text(), date = new Date(stamp);
      assert.ok(date.getTime() <= now && (date.toISOString() === stamp || date.toISOString().slice(0, 10) === stamp),
        `invalid/future lastmod on ${path}`);
    }
    const alternates = new Map();
    for (const link of entry.children("xhtml\\:link")) {
      const attrs = link.attribs;
      assert.equal(attrs.rel, "alternate");
      assert.ok(languages.includes(attrs.hreflang) && !alternates.has(attrs.hreflang), `invalid hreflang on ${path}`);
      alternates.set(attrs.hreflang, canonicalPath(attrs.href));
    }
    entries.set(path, alternates);
  }
  for (const [path, alternates] of entries) {
    if (/^\/(?:(?:en|de|ru)\/)?(?:festivals|artists)\/[^/]+\/$/.test(path)) {
      assert.equal(alternates.size, languages.length, `missing detail hreflang on ${path}`);
    }
    if (!alternates.size) continue;
    assert.equal(alternates.size, languages.length, `incomplete hreflang on ${path}`);
    const barePath = path.replace(/^\/(?:en|de|ru)\//, "/");
    for (const lang of languages) {
      const target = lang === "x-default" ? barePath : `/${lang}${barePath}`;
      assert.equal(alternates.get(lang), target, `incorrect hreflang ${lang} on ${path}`);
      assert.deepEqual(entries.get(target), alternates, `nonreciprocal hreflang: ${path} → ${target}`);
    }
  }
  for (const path of ["/", "/en/", "/de/", "/ru/"]) {
    assert.equal(entries.get(path)?.size, languages.length, `missing home hreflang on ${path}`);
  }
  return entries;
}

export async function checkIndexing(origin = site) {
  assert.ok(origin === site || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "use the public site or a loopback test origin");
  const robots = await get(origin, "/robots.txt", ["text/plain"], 64_000);
  assert.match(robots, /^Sitemap:\s*https:\/\/loudweekend\.eu\/sitemap\.xml\s*$/mi);
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/mi);
  const xml = await get(origin, "/sitemap.xml", ["application/xml", "text/xml"], 50 * 1024 ** 2);
  const entries = inspectSitemap(xml);
  // Check all members of a representative localized cluster plus the canonical
  // path for each catalogue route class; do not crawl the entire site.
  const examples = [...entries.keys()].sort();
  const sample = new Set(["/", "/en/", "/de/", "/ru/", "/submit/", "/archive/"]);
  for (const type of [/^\/festivals\/[^/]+\/$/, /^\/artists\/[^/]+\/$/, /^\/festivals\/[^/]+\/\d+\/$/,
    /^\/editions\/\d+\/$/, /^\/countries\/[a-z]{2}\/$/, /^\/months\/\d{2}\/$/]) {
    const path = examples.find((value) => type.test(value));
    assert.ok(path, `missing sitemap route class ${type}`);
    sample.add(path);
    for (const target of entries.get(path).values()) sample.add(target);
  }
  for (const path of sample) {
    assert.ok(entries.has(path), `sample not listed: ${path}`);
    const html = await get(origin, path, ["text/html"], 12 * 1024 ** 2);
    const $ = load(html);
    const lang = /^\/(en|de|ru)\//.exec(path)?.[1];
    if (lang) assert.equal($("html").attr("lang"), lang, `document language mismatch on ${path}`);
    const canonical = $('link[rel="canonical"]');
    assert.equal(canonical.length, 1, `expected a single canonical on ${path}`);
    assert.equal(canonical.attr("href"), site + path, `canonical mismatch on ${path}`);
    const robotsDirectives = $('meta[name="robots" i], meta[name="googlebot" i], meta[name="bingbot" i]')
      .map((_, node) => $(node).attr("content")).get().join(",");
    assert.doesNotMatch(robotsDirectives, /(?:^|,)\s*(?:noindex|none)\s*(?:,|$)/i, `not indexable: ${path}`);
    for (const [lang, target] of entries.get(path)) {
      const link = $(`link[rel="alternate"][hreflang="${lang}"]`);
      assert.equal(link.length, 1, `missing/duplicate ${lang} alternate on ${path}`);
      assert.equal(link.attr("href"), site + target, `alternate mismatch on ${path}`);
    }
  }
  return { entries: entries.size, sampled: sample.size };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await checkIndexing(process.argv[2]);
  console.log(`Indexing smoke passed: ${result.entries} sitemap URLs, ${result.sampled} public pages sampled.`);
}
