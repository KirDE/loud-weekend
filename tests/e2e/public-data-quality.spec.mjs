import { expect, test } from "@playwright/test";

const labels = {
  en: {
    title: "Catalogue data quality",
    coverage: "Published coverage",
    noCheck: "No current successful check to display.",
  },
  de: {
    title: "Datenqualität des Katalogs",
    coverage: "Veröffentlichte Abdeckung",
    noCheck: "Keine aktuelle erfolgreiche Prüfung vorhanden.",
  },
  ru: {
    title: "Качество данных каталога",
    coverage: "Опубликованные данные",
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
