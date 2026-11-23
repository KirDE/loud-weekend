import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { arrivalRecords } from "../../lib/catalog/arrival-facts.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const headings = {
  en: "Venue and arrival",
  de: "Veranstaltungsort und Anreise",
  ru: "Место проведения и проезд",
};

test("arrival details show source-linked 2027 facts but omit unmatched editions", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const fixtureIds = [];
  try {
    for (const record of arrivalRecords) {
      const festival = await db.festival.create({
        data: {
          slug: record.slug, name: `Arrival fixture ${record.slug}`, country: "Fixture",
          countryCode: record.countryCode, officialUrl: `https://www.${record.organizer}/`,
          genres: [], catalogOrder: 9100,
          editions: { create: {
            year: record.year, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT",
            completeness: "TBA", sourceUpdatedAt: new Date(),
          } },
        },
        select: { id: true },
      });
      fixtureIds.push(festival.id);
    }
    for (const [locale, heading] of Object.entries(headings)) {
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      try {
        const page = await context.newPage();
        for (const record of arrivalRecords) {
          await page.goto(`/${locale}/festivals/${record.slug}/`);
          const panel = page.getByRole("region", { name: heading });
          await expect(panel.locator("dd")).toHaveCount(record.facts.length);
          await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
          for (const fact of record.facts) {
            await expect(panel.getByText(fact.description[locale], { exact: false })).toBeVisible();
            await expect(panel.locator(`a[href="${fact.source}"]`)).toHaveAttribute("rel", "noreferrer");
          }
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
          await page.goto(`/festivals/${record.slug}/${record.year}/`);
          await expect(page.getByRole("region", { name: heading }).locator("dd")).toHaveCount(record.facts.length);
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        }
        await page.goto(`/${locale}/festivals/synthetic-fest/`);
        await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
    await db.festivalEdition.updateMany({ where: { festivalId: fixtureIds[0] }, data: { year: 2028 } });
    const page = await browser.newPage();
    try {
      await page.goto(`/en/festivals/${arrivalRecords[0].slug}/`);
      await expect(page.getByRole("heading", { name: `Arrival fixture ${arrivalRecords[0].slug}`, exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: headings.en })).toHaveCount(0);
    } finally {
      await page.close();
    }
  } finally {
    if (fixtureIds.length) await db.festival.deleteMany({ where: { id: { in: fixtureIds } } });
    await db.$disconnect();
  }
});
