import { expect, test } from "@playwright/test";

const labels = {
  en: {
    title: "Catalogue data quality",
    coverage: "Published coverage",
    ticketCategories: "Published ticket categories",
    noCheck: "No current successful check to display.",
  },
  de: {
    title: "Datenqualität des Katalogs",
    coverage: "Veröffentlichte Abdeckung",
    ticketCategories: "Veröffentlichte Ticketkategorien",
    noCheck: "Keine aktuelle erfolgreiche Prüfung vorhanden.",
  },
  ru: {
    title: "Качество данных каталога",
    coverage: "Опубликованные данные",
    ticketCategories: "Опубликованы категории билетов",
    noCheck: "Нет актуальной успешной проверки для отображения.",
  },
};

for (const [lang, t] of Object.entries(labels))
  test(`${lang}: current catalogue coverage is readable at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${lang}/`);
    await page.getByRole("link", { name: t.title }).click();
    await expect(page).toHaveURL(new RegExp(`/${lang}/data-quality/$`));
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: t.coverage })).toBeVisible();
    await expect(page.locator(".dataQualityCount dd").first()).toHaveText("4 / 4");
    await expect(
      page.locator(".dataQualityCount").filter({ hasText: t.ticketCategories }).locator("dd"),
    ).toHaveText("0 / 4");
    await expect(page.getByText(t.noCheck, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

test("changing the language on the quality page updates copy and document language together", async ({
  page,
}) => {
  await page.goto("/en/data-quality/");
  await page.locator("footer").getByRole("combobox", { name: "Language" }).selectOption("ru");
  await expect(page.getByRole("heading", { level: 1, name: labels.ru.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: labels.ru.coverage })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

const lineupDayLabels = {
  en: "Published lineup by day",
  de: "Veröffentlichtes Line-up nach Tagen",
  ru: "Опубликован состав по дням",
};

for (const [lang, label] of Object.entries(lineupDayLabels))
  test(`${lang}: lineup-by-day coverage has a separate localized row`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${lang}/data-quality/`);
    const row = page.locator(".dataQualityCount").filter({ hasText: label });
    await expect(row.locator("dt")).toHaveText(label);
    await expect(row.locator("dd")).toHaveText(/^[0-4] \/ 4$/);
  });
