import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { importReviewedArrival } from "../../lib/catalog/arrival-import.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const headings = {
  en: "Venue and arrival",
  de: "Veranstaltungsort und Anreise",
  ru: "Место проведения и проезд",
};

test("arrival details come from reviewed rows for the exact edition and organizer", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const slug = "browser-arrival-fixture";
  const officialUrl = "https://www.arrival.example.test/";
  const review = {
    festivalSlug: slug, editionYear: 2030, countryCode: "DE", organizerHost: "arrival.example.test",
    facts: [{
      kind: "railShuttle",
      description: { en: "Coach from Central Station", de: "Bus ab Hauptbahnhof", ru: "Автобус от вокзала" },
      sourceUrl: officialUrl + "reviewed-travel/2030",
      supportingSourceUrl: "https://operator.example.test/2030",
      checkedOn: "2026-11-23",
    }],
  };
  const [fact] = review.facts;
  const edition = {
    status: "TBA", ticketStatus: "UNKNOWN", completeness: "TBA", sourceUpdatedAt: new Date(),
  };
  let festivalId;
  try {
    const festival = await db.festival.create({
      data: {
        slug, name: "Arrival fixture", country: "Germany", countryCode: "DE", officialUrl,
        genres: [], catalogOrder: 9100,
        editions: { create: [
          { ...edition, year: 2030, recordState: "CURRENT" },
          { ...edition, year: 2029, recordState: "ARCHIVED" },
        ] },
      },
    });
    festivalId = festival.id;
    const rows = () => db.editionArrivalFact.findMany({ where: { edition: { festivalId } } });
    expect((await importReviewedArrival(db, review)).checkOnly).toBe(true);
    expect(await rows()).toEqual([]);

    for (const invalid of [
      { ...review, editionYear: 2031 },
      { ...review, editionYear: 2029 },
      { ...review, countryCode: "BE" },
      { ...review, organizerHost: "other.example.test" },
      { ...review, facts: [{ ...fact, sourceUrl: "https://other.example.test/travel" }] },
    ]) {
      await expect(importReviewedArrival(db, invalid, false)).rejects.toThrow();
    }
    expect(await rows()).toEqual([]);
    await importReviewedArrival(db, review, false);
    await importReviewedArrival(db, review, false);
    expect(await rows()).toMatchObject([{ kind: fact.kind, supportingSourceUrl: fact.supportingSourceUrl }]);
    await expect(importReviewedArrival(db, { ...review, facts: [{ ...fact, checkedOn: "2026-11-22" }] }, false))
      .rejects.toThrow("more recently reviewed");

    for (const [locale, heading] of Object.entries(headings)) {
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      try {
        const page = await context.newPage();
        await page.goto(`/${locale}/festivals/${slug}/`);
        const panel = page.getByRole("region", { name: heading });
        await expect(panel.locator("dd")).toHaveCount(1);
        await expect(panel.getByText(fact.description[locale], { exact: false })).toBeVisible();
        await expect(panel.locator(`time[datetime="${fact.checkedOn}"]`)).toBeVisible();
        await expect(panel.locator(`a[href="${fact.sourceUrl}"]`)).toHaveAttribute("rel", "noreferrer");
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        await page.goto(`/festivals/${slug}/2030/`);
        await expect(panel.locator("dd")).toHaveCount(1);
        await page.goto(`/festivals/${slug}/2029/`);
        await expect(panel).toHaveCount(0);
      } finally {
        await context.close();
      }
    }

    const page = await browser.newPage();
    try {
      await page.goto(`/festivals/${slug}/`);
      await expect(page.getByRole("region", { name: headings.en })).toBeVisible();
      await db.festival.update({ where: { id: festivalId }, data: { officialUrl: "https://new.example.test/" } });
      await page.reload();
      await expect(page.getByRole("heading", { name: "Arrival fixture", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: headings.en })).toHaveCount(0);

      await db.festival.update({ where: { id: festivalId }, data: { officialUrl } });
      await db.festivalEdition.update({
        where: { festivalId_year: { festivalId, year: 2030 } },
        data: { year: 2032 },
      });
      await page.reload();
      await expect(page.getByRole("region", { name: headings.en })).toHaveCount(0);
    } finally {
      await page.close();
    }
  } finally {
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    await db.$disconnect();
  }
});
