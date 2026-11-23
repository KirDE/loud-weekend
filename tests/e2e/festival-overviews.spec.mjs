import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { editorialOverviews } from "../../lib/catalog/festival-overviews.ts";
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
    const [name, country, countryCode] = fixtures[overview.slug];
    const festival = await db.festival.create({ data: {
      slug: overview.slug, name, country, countryCode, city: overview.place, genres: [],
      officialUrl: new URL(overview.sources[0]).origin, catalogOrder: 9000,
      editions: { create: {
        year: overview.year, status: "TBA", ticketStatus: "UNKNOWN",
        recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      } },
    } });
    inserted.push(festival.id);
  }
});

test.afterAll(async () => {
  await db.festival.deleteMany({ where: { id: { in: inserted } } });
  await db.$disconnect();
});

for (const [lang, heading] of Object.entries({ en: "About this festival", de: "Über dieses Festival", ru: "О фестивале" })) {
  test(`${lang} shows each editorial overview and official source, but not missing copy`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    for (const overview of editorialOverviews) {
      await page.goto(`/${lang}/festivals/${overview.slug}/`);
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
