import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";
import { parseSeasonYear, publicSeasonEditions } from "../lib/catalog/seasons.ts";
import { canonicalPath, localizedAlternates } from "../lib/seo.ts";
import { socialPreviewMetadata } from "../lib/social-preview.ts";

const source = await readFile(
  new URL("../app/[lang]/festivals/[slug]/[year]/page.tsx", import.meta.url),
  "utf8",
);
const { code } = await transform(source, { loader: "tsx", format: "cjs" });
function loadRoute(editions) {
  const calls = [];
  const module = { exports: {} };
  const dependencies = {
    "next/navigation": {
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    },
    "@/app/festivals/[slug]/[year]/page": {
      __esModule: true,
      default: async ({ params }) => {
        calls.push(await params);
        return "shared edition body";
      },
    },
    "@/lib/catalog/repository": { getCatalog: async () => ({ editions }) },
    "@/lib/catalog/public": { supportedLanguages: ["en", "de", "ru"] },
    "@/lib/catalog/seasons": { parseSeasonYear, publicSeasonEditions },
    "@/lib/seo": { canonicalPath, localizedAlternates },
    "@/lib/social-preview": { socialPreviewMetadata },
  };
  new Function("require", "module", "exports", code)(
    (id) => {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected route dependency: ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return { ...module.exports, calls };
}

test("localized exact editions delegate to the shared body and preserve SEO language/year", async () => {
  for (const recordState of ["current", "archived", "tracking"]) {
    const item = {
      slug: "fixture",
      name: "Fixture Festival",
      editionYear: 2026,
      recordState,
      snapshotAt: recordState === "archived" ? "2026-11-01T00:00:00Z" : undefined,
      provenance: [{ field: "edition" }],
    };
    const route = loadRoute([item]);
    assert.equal(route.dynamic, "force-dynamic");
    for (const lang of ["en", "de", "ru"]) {
      const props = { params: Promise.resolve({ lang, slug: item.slug, year: "2026" }) };
      assert.equal(await route.default(props), "shared edition body");
      assert.deepEqual(route.calls.at(-1), { slug: item.slug, year: "2026" });
      const meta = await route.generateMetadata(props);
      assert.equal(meta.title, "Fixture Festival 2026");
      assert.equal(meta.alternates.canonical, `/${lang}/festivals/fixture/2026/`);
      assert.deepEqual(meta.alternates.languages, localizedAlternates("/festivals/fixture/2026/"));
      assert.ok(
        meta.openGraph.images[0].url.includes(`/api/social/${lang}/festivals/fixture/2026/`),
      );
    }
  }
});

test("reject unsupported locale; omit invalid, unknown and unreviewed tracking metadata", async () => {
  const route = loadRoute([
    { slug: "fixture", editionYear: 2028, recordState: "tracking", provenance: [] },
  ]);
  const props = (lang, year, slug = "fixture") => ({
    params: Promise.resolve({ lang, year, slug }),
  });
  await assert.rejects(route.default(props("fr", "2028")), /NEXT_NOT_FOUND/);
  await assert.rejects(route.generateMetadata(props("fr", "2028")), /NEXT_NOT_FOUND/);
  assert.deepEqual(route.calls, []);
  for (const year of ["02028", "2e3", "0000", "2027", "2028"]) {
    assert.deepEqual(await route.generateMetadata(props("de", year)), {});
  }
  assert.deepEqual(await route.generateMetadata(props("ru", "2028", "unknown")), {});
});

test("unsnapshotted archive metadata is excluded in every locale despite edition provenance", async () => {
  const item = {
    slug: "fixture",
    name: "Fixture Festival",
    editionYear: 2026,
    recordState: "archived",
    provenance: [{ field: "edition" }],
  };
  assert.deepEqual(publicSeasonEditions([item]), []);
  const route = loadRoute([item]);
  for (const lang of ["en", "de", "ru"]) {
    assert.deepEqual(
      await route.generateMetadata({
        params: Promise.resolve({ lang, slug: item.slug, year: "2026" }),
      }),
      {},
    );
  }
});
