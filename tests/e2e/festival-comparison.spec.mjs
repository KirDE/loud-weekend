import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const labels = {
  en: {
    triple: "All three festivals",
    duration: "Duration (days)",
    favorites: "Favorite acts",
    camping: "Camping",
    unknown: "Not verified",
  },
  de: {
    triple: "Alle drei Festivals",
    duration: "Dauer (Tage)",
    favorites: "Lieblingskünstler",
    camping: "Camping",
    unknown: "Nicht verifiziert",
  },
  ru: {
    triple: "Все три фестиваля",
    duration: "Длительность (дни)",
    favorites: "Избранные исполнители",
    camping: "Кемпинг",
    unknown: "Не подтверждено",
  },
};
for (const [locale, t] of Object.entries(labels)) {
  test(`compare three festivals without losing selections when filtered (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ favoriteArtists: ["artist:second-artist"] }));
    });
    await page.goto(`/${locale}/`);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    for (const name of ["Synthetic Alpine", "Synthetic Fest", "Synthetic West"]) {
      await page
        .locator(".festivalCard")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .locator(".compareButton")
        .click();
    }
    const table = page.locator(".comparisonTable");
    const row = (heading) =>
      table
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: heading, exact: true }) });
    for (const pair of [
      /^(?:Synthetic Alpine \/ Synthetic Fest|Synthetic Fest \/ Synthetic Alpine)$/,
      /^(?:Synthetic Alpine \/ Synthetic West|Synthetic West \/ Synthetic Alpine)$/,
      /^(?:Synthetic Fest \/ Synthetic West|Synthetic West \/ Synthetic Fest)$/,
    ])
      await expect(row(pair)).toContainText("Sample Artist");
    await expect(row(t.triple)).toContainText("Sample Artist");
    await expect(row(t.duration).getByRole("cell")).toHaveText(["3", "3", "3"]);
    await expect(row(t.favorites)).toContainText("Second Artist");
    await expect(row(t.camping).getByRole("cell")).toHaveText([t.unknown, t.unknown, t.unknown]);
    await page.locator(".search input").fill("no matching festival");
    await expect(page.locator(".festivalCard")).toHaveCount(0);
    await expect(table.getByRole("columnheader")).toHaveCount(4);
    const scroller = page.locator(".comparisonScroll");
    await scroller.focus();
    await expect(scroller).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  });
}

test("comparison displays only matching public trip facts in every locale", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const rows = await db.festivalEdition.findMany({
    where: {
      recordState: "CURRENT",
      festival: { slug: { in: ["synthetic-fest", "synthetic-west"] } },
    },
    select: {
      id: true,
      year: true,
      festival: { select: { slug: true, countryCode: true, city: true } },
    },
  });
  const current = rows.find(({ festival }) => festival.slug === "synthetic-fest");
  const west = rows.find(({ festival }) => festival.slug === "synthetic-west");
  // Earlier editorial scenarios can publish a new city for the shared catalogue fixture.
  expect(current?.festival.city).toBeTruthy();
  const source = {
    organizerHost: "festival.example.test",
    checkedOn: new Date("2026-11-01"),
  };
  const description = {
    descriptionEn: "Fixture transfer",
    descriptionDe: "Test-Shuttle",
    descriptionRu: "Тестовый шаттл",
  };
  const campingUrl = "https://festival.example.test/camping";
  const arrivalUrl = "https://festival.example.test/shuttle";
  try {
    await db.$transaction([
      db.editionCampingFact.create({
        data: {
          ...source,
          editionId: current.id,
          editionYear: current.year,
          countryCode: current.festival.countryCode,
          city: current.festival.city,
          field: "arrival",
          earliestDate: new Date("2027-06-09"),
          sourceUrl: campingUrl,
        },
      }),
      db.editionCampingFact.create({
        data: {
          ...source,
          ...description,
          editionId: west.id,
          editionYear: west.year,
          countryCode: west.festival.countryCode,
          city: "Old fixture location",
          field: "camping",
          sourceUrl: campingUrl,
        },
      }),
      db.editionArrivalFact.createMany({
        data: [
          {
            ...source,
            ...description,
            editionId: current.id,
            editionYear: current.year,
            countryCode: current.festival.countryCode,
            kind: "shuttle",
            sourceUrl: arrivalUrl,
          },
          {
            ...source,
            ...description,
            editionId: west.id,
            editionYear: west.year,
            countryCode: west.festival.countryCode,
            kind: "shuttle",
            sourceUrl: "https://foreign.example.test/shuttle",
          },
        ],
      }),
    ]);
    for (const [locale, t] of Object.entries(labels)) {
      const page = await browser.newPage({ viewport: { width: 320, height: 850 } });
      try {
        await page.goto(`/${locale}/`);
        await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
        for (const name of ["Synthetic Fest", "Synthetic West"]) {
          await page
            .locator(".festivalCard")
            .filter({ has: page.getByRole("heading", { name, exact: true }) })
            .locator(".compareButton")
            .click();
        }
        const table = page.locator(".comparisonTable");
        await expect(table.locator(`a[href="${campingUrl}"]`)).toHaveCount(1);
        await expect(table.locator('time[datetime="2027-06-09"]')).toBeVisible();
        const shuttle = table.locator(`a[href="${arrivalUrl}"]`);
        await expect(shuttle).toHaveCount(1);
        const localized = {
          en: description.descriptionEn,
          de: description.descriptionDe,
          ru: description.descriptionRu,
        };
        await expect(shuttle.locator("..")).toContainText(localized[locale]);
        await expect(table.getByRole("cell", { name: t.unknown, exact: true })).toHaveCount(2);
        await expect(table.locator('a[href*="foreign.example"]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          320,
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await db.$transaction([
      db.editionCampingFact.deleteMany({ where: { editionId: { in: [current.id, west.id] } } }),
      db.editionArrivalFact.deleteMany({ where: { editionId: { in: [current.id, west.id] } } }),
    ]);
    await db.$disconnect();
  }
});
