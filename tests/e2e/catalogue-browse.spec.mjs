import { expect, test } from "@playwright/test";

const labels = {
  en: {
    browse: "Browse",
    countries: "Countries",
    months: "Months",
    seasons: "Seasons",
    artists: "Artists",
    search: "Find an artist",
  },
  de: {
    browse: "Entdecken",
    countries: "Länder",
    months: "Monate",
    seasons: "Saisons",
    artists: "Künstler",
    search: "Künstler finden",
  },
  ru: {
    browse: "Каталог",
    countries: "Страны",
    months: "Месяцы",
    seasons: "Сезоны",
    artists: "Исполнители",
    search: "Найти исполнителя",
  },
};
for (const [lang, labelsForLocale] of Object.entries(labels)) {
  test(`browse real catalogue sections at 320px (${lang})`, async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(`/${lang}/`);
    const browse = page
      .getByRole("navigation")
      .getByRole("link", { name: labelsForLocale.browse, exact: true });
    await browse.focus();
    await browse.press("Enter");
    await expect(page).toHaveURL("/browse/");
    await expect(browse).toHaveAttribute("aria-current", "page");
    for (const key of ["countries", "months", "seasons", "artists"]) {
      await expect(
        page.getByRole("heading", { name: labelsForLocale[key], exact: true }),
      ).toBeVisible();
    }
    const directory = page.locator(".catalogueBrowse");
    for (const path of ["/countries/de/", "/months/06/", "/editions/2027/"]) {
      await expect(directory.locator(`a[href="${path}"]`)).toHaveCount(1);
      expect((await request.get(path)).status()).toBe(200);
    }
    const archiveLink = directory.locator('a[href="/archive/"]');
    const archive = await request.get("/archive/");
    await expect(archiveLink).toHaveCount(archive.status() === 200 ? 1 : 0);
    expect([200, 404]).toContain(archive.status());
    await page.getByRole("searchbox", { name: labelsForLocale.search }).fill("Second");
    await expect(directory.locator('a[href="/artists/sample-artist/"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await directory.getByRole("link", { name: "Second Artist", exact: true }).click();
    await expect(page).toHaveURL("/artists/second-artist/");
    await expect(browse).toHaveAttribute("aria-current", "location");
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
  });
}
