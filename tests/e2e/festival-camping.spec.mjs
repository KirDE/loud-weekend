import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { campingRecords } from "../../lib/catalog/camping-facts.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("validated edition camping facts are accessible in every locale", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    for (const record of campingRecords) {
      const festival = await db.festival.create({
        data: {
          slug: record.slug, name: `Edition fixture ${record.city}`,
          city: record.city, country: "Fixture country", countryCode: "DE",
          officialUrl: `https://www.${record.organizer}/`, genres: [], catalogOrder: 9000,
          editions: { create: {
            year: record.year, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT",
            completeness: "TBA", sourceUpdatedAt: new Date(),
          } },
        },
        select: { id: true },
      });
      inserted.push(festival.id);
    }

    for (const [lang, heading] of Object.entries({ en: "Camping and on-site facilities", de: "Camping und Ausstattung", ru: "Кемпинг и удобства" })) {
      const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
      try {
        const page = await context.newPage();
        for (const record of campingRecords) {
          await page.goto(`/${lang}/festivals/${record.slug}/`);
          const panel = page.getByRole("region", { name: heading });
          await expect(panel.locator("dd")).toHaveCount(record.facts.length);
          await expect(panel.locator(`a[href="${record.source}"]`)).toBeVisible();
          await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
          const arrival = record.facts.find(fact => fact.field === "arrival").earliestDate;
          await expect(panel.locator(`time[datetime="${arrival}"]`)).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        }
        await page.goto(`/${lang}/festivals/synthetic-fest/`);
        await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        if (lang === "ru") {
          const first = campingRecords[0];
          await db.festivalEdition.updateMany({ where: { festivalId: inserted[0], year: first.year }, data: { year: first.year + 1 } });
          await page.goto(`/${lang}/festivals/${first.slug}/`);
          await expect(page.getByRole("heading", { name: "Edition fixture Wacken", exact: true })).toBeVisible();
          await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    if (inserted.length) await db.festival.deleteMany({ where: { id: { in: inserted } } });
    await db.$disconnect();
  }
});
