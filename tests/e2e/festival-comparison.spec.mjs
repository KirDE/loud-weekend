import { expect, test } from "@playwright/test";

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
