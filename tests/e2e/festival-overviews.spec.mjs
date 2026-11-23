import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { readFile } from "node:fs/promises";
import { importReviewedOverview } from "../../lib/catalog/festival-overview-import.ts";

const editorialOverviews = await Promise.all(["wacken-open-air", "alcatraz", "hellfest"].map(async slug =>
  JSON.parse(await readFile(new URL(`../../catalog-data/overviews/${slug}-2027.json`, import.meta.url), "utf8")),
));
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const inserted = [];
const fixtures = {
  "wacken-open-air": ["Wacken Open Air", "Germany", "DE"],
  alcatraz: ["Alcatraz Open Air", "Belgium", "BE"],
  hellfest: ["Hellfest", "France", "FR"],
};

test.beforeAll(async () => {
  for (const overview of editorialOverviews) {
    const [name, country, countryCode] = fixtures[overview.festivalSlug];
    const festival = await db.festival.create({ data: {
      slug: overview.festivalSlug, name, country, countryCode, city: overview.city, genres: [],
      officialUrl: new URL(overview.sources[0]).origin, catalogOrder: 9000,
      editions: { create: {
        year: overview.editionYear, status: "TBA", ticketStatus: "UNKNOWN",
        recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      } },
    } });
    inserted.push(festival.id);
    await importReviewedOverview(db, overview);
  }
});

test("preview does not publish; reviewed imports are edition-bound and repeatable", async ({ page }) => {
  const [record] = editorialOverviews;
  const url = `/en/festivals/${record.festivalSlug}/`;
  const panel = page.getByRole("region", { name: "About this festival" });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixtures[record.festivalSlug][0]);
  await expect(panel).toHaveCount(0);
  await expect(importReviewedOverview(db, { ...record, city: "Another city" }, false)).rejects.toThrow(/exact catalogue edition/);
  await expect(importReviewedOverview(db, { ...record, sources: ["https://cross-site.example.test/"] }, false)).rejects.toThrow(/organizer host/);
  await expect(importReviewedOverview(db, { ...record, editionYear: record.editionYear + 1 }, false)).rejects.toThrow();
  for (const overview of editorialOverviews) await importReviewedOverview(db, overview, false);
  await importReviewedOverview(db, record, false);
  await expect(importReviewedOverview(db, { ...record, checkedOn: "2020-01-01" }, false)).rejects.toThrow(/more recently/);
  await page.reload();
  await expect(panel.getByText(record.summary.en)).toBeVisible();

  const where = { slug: record.festivalSlug };
  await db.festival.update({ where, data: { city: null } });
  try {
    await page.reload();
    await expect(panel).toHaveCount(0);
  } finally {
    await db.festival.update({ where, data: { city: record.city } });
  }
});

test.afterAll(async () => {
  await db.festival.deleteMany({ where: { id: { in: inserted } } });
  await db.$disconnect();
});

for (const [lang, heading] of Object.entries({ en: "About this festival", de: "Über dieses Festival", ru: "О фестивале" })) {
  test(`${lang} shows each editorial overview and official source, but not missing copy`, async ({ page }) => {
    for (const overview of editorialOverviews) await importReviewedOverview(db, overview, false);
    await page.setViewportSize({ width: 320, height: 760 });
    for (const overview of editorialOverviews) {
      await page.goto(`/${lang}/festivals/${overview.festivalSlug}/`);
      const panel = page.getByRole("region", { name: heading });
      await expect(panel.getByText(overview.summary[lang], { exact: true })).toBeVisible();
      for (const source of overview.sources) await expect(panel.locator(`a[href="${source}"]`)).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", overview.checkedOn);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }
    await page.goto(`/${lang}/festivals/synthetic-fest/`);
    await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
  });
}
