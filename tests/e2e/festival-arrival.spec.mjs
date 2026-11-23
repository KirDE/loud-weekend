import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectReviewedArrival } from "../../lib/ingestion/arrival-collector.ts";
import { arrivalSourceUrls } from "../../lib/ingestion/adapters/arrival-guidance.ts";
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

test("Graspop arrival comes from the reviewed organizer observation", async ({ page }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const [essentials, announcement] = arrivalSourceUrls("graspop", 2027);
  const fixture = name => readFile(new URL(`../fixtures/arrival/${name}.html`, import.meta.url), "utf8");
  const pages = new Map([[essentials, await fixture("graspop-essentials")], [announcement, await fixture("graspop-announcement")]]);
  const collect = approval => collectReviewedArrival(db, "graspop", 2027, { approval, fetchImpl: async (url, init) => {
    expect(init.redirect).toBe("error");
    expect(pages.has(url)).toBe(true);
    const response = new Response(pages.get(url), { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  } });
  let festivalId;
  try {
    const item = await db.festival.create({ data: {
      slug: "graspop", name: "Arrival source fixture", country: "Belgium", countryCode: "BE",
      officialUrl: "https://www.graspop.be/", genres: [], catalogOrder: 9100,
      editions: { create: {
        year: 2027, status: "TBA", ticketStatus: "UNKNOWN",
        recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date(),
      } },
    } });
    festivalId = item.id;
    const preview = await collect();
    pages.set(announcement, pages.get(announcement).replace("Eindhoven Airport", "Antwerp Airport"));
    await expect(collect(preview.fingerprint)).rejects.toThrow(/changed since preview/);
    expect(await db.editionArrivalFact.count({ where: { edition: { festivalId } } })).toBe(0);
    const revised = await collect();
    await collect(revised.fingerprint);
    await page.goto("/en/festivals/graspop/");
    const panel = page.getByRole("region", { name: headings.en });
    await expect(panel.locator("dd")).toHaveCount(2);
    await expect(panel.getByText(/Antwerp Airport/)).toBeVisible();
    await expect(panel.getByText(/Eindhoven Airport/)).toHaveCount(0);
  } finally {
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    await db.$disconnect();
  }
});
