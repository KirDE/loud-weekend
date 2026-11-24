import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("large catalogue keeps comparison and search across rendered batches", async ({ page }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const prefix = "batch-fixture-";
  const ids = Array.from({ length: 46 }, (_, i) => prefix + String(i + 1).padStart(2, "0"));
  let inserted = false;
  try {
    await db.$transaction([
      db.festival.createMany({
        data: ids.map((id, index) => ({
          id,
          slug: id,
          name: `Batch Fixture ${index + 1}`,
          country: "Germany",
          countryCode: "DE",
          officialUrl: "https://festival.example.test/",
          genres: [],
          catalogOrder: 100 + index,
        })),
      }),
      db.festivalEdition.createMany({
        data: ids.map((festivalId) => ({
          festivalId,
          year: 2027,
          recordState: "CURRENT",
          status: "TBA",
          completeness: "TBA",
          ticketStatus: "UNKNOWN",
          sourceUpdatedAt: new Date(),
        })),
      }),
    ]);
    inserted = true;
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/en/");
    const grid = page.locator(".festivalGrid");
    const headers = grid.getByRole("heading");
    await expect(headers).toHaveCount(48);
    const search = page.getByRole("textbox", { name: "Search festivals, artists or cities" });
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    await grid.getByRole("button", { name: "Compare Synthetic Fest", exact: true }).click();
    await page.getByRole("button", { name: "Show more festivals (2)" }).click();
    await expect(headers).toHaveCount(50);
    const link = grid.getByRole("article").nth(48).getByRole("link");
    await expect(link).toBeFocused();
    await grid.getByRole("button", { name: "Compare Batch Fixture 46", exact: true }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Synthetic Fest" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Batch Fixture 46" })).toBeVisible();
    await search.fill("Batch Fixture 46");
    await expect(headers).toHaveText(["Batch Fixture 46"]);
    await expect(table.getByRole("columnheader", { name: "Synthetic Fest" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(headers).toHaveCount(48);
    await expect(page.getByRole("button", { name: "Show more festivals (2)" })).toBeVisible();

    await page.goto("/en/?filters=1");
    await expect(headers).toHaveCount(48);
    await page.getByRole("button", { name: "Show more festivals (2)" }).click();
    await expect(headers).toHaveCount(50);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  } finally {
    if (inserted) await db.festival.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
