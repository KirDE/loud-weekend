import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { importReviewedCamping } from "../../lib/catalog/camping-import.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const recordsDirectory = new URL("../../catalog-data/camping/", import.meta.url);
const inputFiles = (await readdir(recordsDirectory)).filter(name => name.endsWith(".json")).sort();
const campingRecords = await Promise.all(inputFiles.map(async name =>
  JSON.parse(await readFile(new URL(name, recordsDirectory), "utf8"))));

test("validated edition camping facts are accessible in every locale", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    for (const record of campingRecords) {
      const festival = await db.festival.create({
        data: {
          slug: record.festivalSlug, name: `Edition fixture ${record.city}`,
          city: record.city, country: "Fixture country", countryCode: record.countryCode,
          officialUrl: `https://www.${record.organizerHost}/`, genres: [], catalogOrder: 9000,
          editions: { create: {
            year: record.editionYear, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT",
            completeness: "TBA", sourceUpdatedAt: new Date(),
          } },
        },
        select: { id: true },
      });
      inserted.push(festival.id);
    }

    const first = campingRecords[0];
    const route = `/en/festivals/${first.festivalSlug}/`;
    const before = await browser.newPage();
    try {
      await importReviewedCamping(db, first);
      await before.goto(route);
      await expect(before.getByRole("heading", { name: "Camping and on-site facilities" })).toHaveCount(0);
    } finally {
      await before.close();
    }
    await expect(importReviewedCamping(db, { ...first, city: "Wrong city" }, false)).rejects.toThrow(/exact catalogue edition/);
    await expect(importReviewedCamping(db, { ...first, editionYear: first.editionYear + 1 }, false)).rejects.toThrow();
    for (const record of campingRecords) await importReviewedCamping(db, record, false);
    await importReviewedCamping(db, { ...first, facts: first.facts.slice(0, 1) }, false);
    await expect(importReviewedCamping(db, { ...first, checkedOn: "2026-01-01" }, false)).rejects.toThrow(/more recently reviewed/);

    for (const [lang, heading] of Object.entries({ en: "Camping and on-site facilities", de: "Camping und Ausstattung", ru: "Кемпинг и удобства" })) {
      const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
      try {
        const page = await context.newPage();
        for (const record of campingRecords) {
          await page.goto(`/${lang}/festivals/${record.festivalSlug}/`);
          const panel = page.getByRole("region", { name: heading });
          await expect(panel.locator("dd")).toHaveCount(record.facts.length);
          await expect(panel.locator(`a[href="${record.sourceUrl}"]`)).toBeVisible();
          await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
          for (const fact of record.facts) {
            if (fact.field === "arrival") {
              await expect(panel.locator(`time[datetime="${fact.earliestDate}"]`)).toBeVisible();
            } else {
              await expect(panel.getByText(fact.description[lang], { exact: true })).toBeVisible();
            }
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        }
        if (lang === "en") {
          await page.goto(`/festivals/${first.festivalSlug}/`);
          await expect(page.getByRole("region", { name: heading })).toBeVisible();
        }
        await page.goto(`/${lang}/festivals/synthetic-fest/`);
        await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        if (lang === "ru") {
          await db.festivalEdition.updateMany({ where: { festivalId: inserted[0], year: first.editionYear }, data: { year: first.editionYear + 1 } });
          await page.goto(`/${lang}/festivals/${first.festivalSlug}/`);
          await expect(page.getByRole("heading", { name: `Edition fixture ${first.city}`, exact: true })).toBeVisible();
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
