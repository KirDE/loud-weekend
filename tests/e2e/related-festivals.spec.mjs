import { expect, test } from "@playwright/test";

const labels = {
  en: {
    heading: "Related festivals",
    genres: "Shared genres",
    favorite: "Favorite acts: 1",
    overlap: "Dates overlap",
  },
  de: {
    heading: "Verwandte Festivals",
    genres: "Gemeinsame Genres",
    favorite: "Lieblingskünstler: 1",
    overlap: "Termine überschneiden sich",
  },
  ru: {
    heading: "Связанные фестивали",
    genres: "Общие жанры",
    favorite: "Избранные исполнители: 1",
    overlap: "Даты пересекаются",
  },
};

for (const [locale, t] of Object.entries(labels)) {
  test(`canonical related acts and distinct recommendation reasons (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ favoriteArtists: ["artist:second-artist"] }));
    });
    await page.goto(`/${locale}/festivals/synthetic-alpine/`);
    const section = page.locator(".recommendations");
    await expect(section.getByRole("heading", { name: t.heading })).toBeVisible();
    const link = section.getByRole("link").first();
    await expect(link).toHaveAttribute("href", `/${locale}/festivals/synthetic-fest/2027/`);
    await expect(link).toContainText(t.genres);
    await expect(link).toContainText(t.favorite);
    await expect(link).toContainText(t.overlap);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await link.focus();
    await link.press("Enter");
    await expect(page).toHaveURL(`/${locale}/festivals/synthetic-fest/2027/`);
  });
}
