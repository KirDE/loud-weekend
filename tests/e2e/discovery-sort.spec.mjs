import { expect, test } from "@playwright/test";

const labels = { en: "Sort festivals", de: "Festivals sortieren", ru: "Сортировка фестивалей" };
const alphabetical = ["Synthetic Alpine", "Synthetic Fest", "Synthetic South", "Synthetic West"];

for (const [locale, name] of Object.entries(labels)) {
  test(`sort festival cards with a keyboard and restore the order (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ favoriteArtists: ["artist:second-artist", "Second Artist"] }));
    });
    await page.goto(`/${locale}/`);
    const sort = page.getByRole("combobox", { name });
    const cards = page.locator(".festivalCard h2");
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveValue("date");
    await sort.focus();
    await sort.press("End");
    await expect(sort).toHaveValue("favorites");
    await expect(cards.first()).toHaveText("Synthetic Fest");
    await sort.selectOption("name");
    await expect(cards).toHaveText(alphabetical);
    await page.reload();
    await expect(sort).toHaveValue("name");
    await expect(cards).toHaveText(alphabetical);
    await sort.selectOption("distance");
    await expect(cards.first()).toHaveText("Synthetic Fest");
    await sort.selectOption("acts");
    await expect(cards.first()).toHaveText("Synthetic Fest");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator(".clearFilters").click();
    await expect(sort).toHaveValue("date");
  });
}
