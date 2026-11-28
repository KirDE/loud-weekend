import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import robotsParser from "robots-parser";

const site = "https://loudweekend.eu";
const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
const xhtmlNamespace = "http://www.w3.org/1999/xhtml";
const languages = ["x-default", "en", "de", "ru"];
const crawlers = ["Googlebot", "Bingbot"];
const monitor = "LoudWeekendIndexingCheck/1.0";
// Next.js serves blocking head metadata for Bingbot. Keep the monitor
// identifiable while requesting that HTML-only crawler representation.
const htmlMonitor = monitor + " (Bingbot metadata compatibility)";
const fixedPaths = ["/", "/en/", "/de/", "/ru/", "/submit/"];
const localizedGuide = /^\/(?:(?:en|de|ru)\/)?guides\/(?:germany|multi-day)\/$/;
const editionDirectory = /^\/(?:(?:en|de|ru)\/)?editions\/\d{4}\/$/;
const localizedEdition = /^\/(?:(?:en|de|ru)\/)?festivals\/[^/]+\/[1-9][0-9]{3}\/$/;
const routeClasses = [
  /^\/browse\/$/,
  /^\/(?:en|de|ru)\/(?:about|faq)\/$/,
  /^\/festivals\/[^/]+\/$/,
  /^\/artists\/[^/]+\/$/,
  localizedEdition,
  editionDirectory,
  /^\/countries\/[a-z]{2}\/$/,
  /^\/months\/(?:0[1-9]|1[0-2])\/$/,
];
const localizedDetail = /^\/(?:(?:en|de|ru)\/)?(?:festivals|artists)\/[^/]+\/$/;

// A header may scope a rule to a crawler. Image preview limits also use
// a colon, but "none" in that value position is not an indexing directive.
const noIndexHeader =
  /(?:^|,)\s*(?:(?!max-image-preview\s*:)[\w-]+\s*:\s*)?(?:noindex|none)\s*(?:,|$)/i;

async function get(origin, path, mime, limit) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": mime.includes("text/html") ? htmlMonitor : monitor },
  });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (response.status !== 200 || !mime.includes(type) || !response.body) {
    await response.body?.cancel();
    throw new Error(
      `${path}: expected HTTP 200 and ${mime.join(" or ")}, got ${response.status} ${type ?? ""}`,
    );
  }
  if (noIndexHeader.test(response.headers.get("x-robots-tag") ?? "")) {
    await response.body.cancel();
    throw new Error(`${path}: X-Robots-Tag disallows indexing`);
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let result = "",
    size = 0;
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

function xmlNamespace(element, binding) {
  for (let node = element; node; node = node.parent) {
    if (node.attribs && Object.hasOwn(node.attribs, binding)) return node.attribs[binding];
  }
}

export function inspectSitemap(xml, now = Date.now()) {
  const $ = load(xml, { xml: true });
  const root = $.root().children();
  assert.equal(root.length, 1, "expected one sitemap root");
  assert.equal(root.get(0)?.name, "urlset");
  assert.equal(root.attr("xmlns"), namespace);
  assert.equal(root.attr("xmlns:xhtml"), xhtmlNamespace);
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
    assert.equal(xmlNamespace(node, "xmlns"), namespace, "invalid url namespace");
    const entry = $(node);
    const location = entry.children("loc");
    assert.equal(location.length, 1);
    assert.equal(xmlNamespace(location[0], "xmlns"), namespace, "invalid loc namespace");
    assert.equal(location.children().length, 0, "invalid loc content");
    const path = canonicalPath(location.text());
    assert.ok(
      fixedPaths.includes(path) ||
        path === "/archive/" ||
        localizedDetail.test(path) ||
        localizedGuide.test(path) ||
        routeClasses.some((type) => type.test(path)),
      `unsupported sitemap path: ${path}`,
    );
    assert.ok(!entries.has(path), `duplicate sitemap path: ${path}`);
    const timestamps = entry.children("lastmod");
    assert.ok(timestamps.length <= 1, `duplicate lastmod on ${path}`);
    if (timestamps.length) {
      assert.equal(
        xmlNamespace(timestamps[0], "xmlns"),
        namespace,
        `invalid lastmod namespace on ${path}`,
      );
      assert.equal(timestamps.children().length, 0, `invalid lastmod content on ${path}`);
      const stamp = timestamps.text(),
        date = new Date(stamp);
      assert.ok(
        date.getTime() <= now &&
          (date.toISOString() === stamp || date.toISOString().slice(0, 10) === stamp),
        `invalid/future lastmod on ${path}`,
      );
    }
    const alternates = new Map();
    for (const link of entry.children("xhtml\\:link")) {
      assert.equal(
        xmlNamespace(link, "xmlns:xhtml"),
        xhtmlNamespace,
        `invalid alternate namespace on ${path}`,
      );
      const attrs = link.attribs;
      assert.equal(attrs.rel, "alternate");
      assert.ok(
        languages.includes(attrs.hreflang) && !alternates.has(attrs.hreflang),
        `invalid hreflang on ${path}`,
      );
      alternates.set(attrs.hreflang, canonicalPath(attrs.href));
    }
    entries.set(path, alternates);
  }
  for (const [path, alternates] of entries) {
    if (
      localizedDetail.test(path) ||
      localizedGuide.test(path) ||
      editionDirectory.test(path) ||
      localizedEdition.test(path)
    ) {
      assert.equal(alternates.size, languages.length, `missing detail hreflang on ${path}`);
    }
    if (!alternates.size) continue;
    assert.equal(alternates.size, languages.length, `incomplete hreflang on ${path}`);
    const barePath = path.replace(/^\/(?:en|de|ru)\//, "/");
    for (const lang of languages) {
      const target = lang === "x-default" ? barePath : `/${lang}${barePath}`;
      assert.equal(alternates.get(lang), target, `incorrect hreflang ${lang} on ${path}`);
      assert.deepEqual(
        entries.get(target),
        alternates,
        `nonreciprocal hreflang: ${path} → ${target}`,
      );
    }
  }
  for (const path of ["/", "/en/", "/de/", "/ru/"]) {
    assert.equal(entries.get(path)?.size, languages.length, `missing home hreflang on ${path}`);
  }
  return entries;
}

function outsideTemplate(_, element) {
  // A parsed template has a document-fragment parent between its contents
  // and the template element, so follow the full tree, including fragments.
  for (let node = element.parent; node; node = node.parent) {
    if (node.name === "template") return false;
  }
  return true;
}

export async function checkIndexing(origin = site) {
  assert.ok(
    origin === site || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
    "use the public site or a loopback test origin",
  );
  const robots = await get(origin, "/robots.txt", ["text/plain"], 64_000);
  assert.match(
    robots,
    /^User-agent:[ \t]*\*[ \t]*(?:#[^\r\n]*)?\r?$/im,
    "missing default robots.txt group",
  );
  const rules = robotsParser(site + "/robots.txt", robots);
  assert.ok(
    rules.getSitemaps().includes(site + "/sitemap.xml"),
    "missing canonical sitemap in robots.txt",
  );
  const checkCrawlAccess = (path) => {
    for (const crawler of crawlers) {
      assert.equal(
        rules.isAllowed(site + path, crawler),
        true,
        `robots.txt blocks ${crawler} on ${path}`,
      );
    }
  };
  checkCrawlAccess("/sitemap.xml");
  const xml = await get(origin, "/sitemap.xml", ["application/xml", "text/xml"], 50 * 1024 ** 2);
  const entries = inspectSitemap(xml);
  for (const path of entries.keys()) checkCrawlAccess(path);
  // Check all members of a representative localized cluster plus the canonical
  // path for each catalogue route class; do not crawl the entire site.
  const examples = [...entries.keys()].sort();
  const sample = new Set([...fixedPaths, ...examples.filter((path) => localizedGuide.test(path))]);
  for (const type of routeClasses) {
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
    const canonical = $('head link[rel="canonical"]').filter(outsideTemplate);
    assert.equal(canonical.length, 1, `expected a single canonical on ${path}`);
    assert.equal(canonical.attr("href"), site + path, `canonical mismatch on ${path}`);
    const robotsDirectives = $(
      'meta[name="robots" i], meta[name="googlebot" i], meta[name="bingbot" i]',
    )
      .filter(outsideTemplate)
      .map((_, node) => $(node).attr("content"))
      .get()
      .join(",");
    assert.doesNotMatch(
      robotsDirectives,
      /(?:^|,)\s*(?:noindex|none)\s*(?:,|$)/i,
      `not indexable: ${path}`,
    );
    for (const [lang, target] of entries.get(path)) {
      const link = $(`head link[rel="alternate"][hreflang="${lang}"]`).filter(outsideTemplate);
      assert.equal(link.length, 1, `missing/duplicate ${lang} alternate on ${path}`);
      assert.equal(link.attr("href"), site + target, `alternate mismatch on ${path}`);
    }
    if (editionDirectory.test(path)) {
      // The year directory links to the archive only when there are archive records.
      const catalogueLink = $(".directoryPage > a").attr("href");
      assert.ok(
        catalogueLink === "/archive/" || catalogueLink === "/browse/",
        `missing catalogue navigation on ${path}`,
      );
      assert.equal(
        entries.has("/archive/"),
        catalogueLink === "/archive/",
        `archive sitemap listing disagrees with ${path}`,
      );
      if (catalogueLink === "/archive/") sample.add("/archive/");
    }
  }
  return { entries: entries.size, sampled: sample.size };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await checkIndexing(process.argv[2]);
  console.log(
    `Indexing smoke passed: ${result.entries} sitemap URLs, ${result.sampled} public pages sampled.`,
  );
}
