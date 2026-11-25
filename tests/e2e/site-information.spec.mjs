import { expect, test } from "@playwright/test";

const copy = {
  en: {
    about: "About",
    heading: "About Loud Weekend",
    faq: "Frequently asked questions",
    calendar: "Can I add festivals to my calendar?",
    planner: "Open the planner",
    source: "Source code",
  },
  de: {
    about: "Über uns",
    heading: "Über Loud Weekend",
    faq: "Häufige Fragen",
    calendar: "Kann ich Festivals in meinen Kalender übernehmen?",
    planner: "Planer öffnen",
    source: "Quellcode",
  },
  ru: {
    about: "О проекте",
    heading: "О Loud Weekend",
    faq: "Частые вопросы",
    calendar: "Можно ли добавить фестивали в календарь?",
    planner: "Открыть планировщик",
    source: "Исходный код",
  },
};

for (const [lang, t] of Object.entries(copy)) {
  test(`localized About and keyboard-operable FAQ (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(`/${lang}/submit/`);
    await page.getByRole("navigation").getByRole("link", { name: t.about, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${lang}/about/$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.heading);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://loudweekend.eu/${lang}/about/`,
    );
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: t.source }),
    ).toHaveAttribute("href", "https://github.com/KirDE/loud-weekend");
    await page.locator(".siteInformation").getByRole("link", { name: t.faq }).click();
    await expect(page).toHaveURL(new RegExp(`/${lang}/faq/$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.faq);
    for (const alt of ["en", "de", "ru"]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${alt}"]`)).toHaveAttribute(
        "href",
        `https://loudweekend.eu/${alt}/faq/`,
      );
    }
    const summary = page.locator(".siteInformation summary").filter({ hasText: t.calendar });
    const link = page.getByRole("link", { name: t.planner });
    await expect(link).toHaveCount(0);
    await summary.focus();
    await summary.press("Enter");
    await expect(link).toHaveAttribute("href", `/${lang}/planner/`);
    await expect(page.locator(".siteInformation")).toHaveAttribute("lang", lang);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  });
}

test("unsupported information locale is not indexed as a translated page", async ({ request }) => {
  expect((await request.get("/fr/faq/")).status()).toBe(404);
});

test("information copy follows language changes and reload without changing SEO alternates", async ({
  page,
}) => {
  await page.goto("/en/faq/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.en.faq);
  await page
    .getByRole("contentinfo")
    .getByRole("combobox", { name: "Language" })
    .selectOption("de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.de.faq);
  await expect(page.locator(".siteInformation")).toHaveAttribute("lang", "de");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://loudweekend.eu/en/faq/",
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.de.faq);
  await page.goto("/en/about/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.de.heading);
});
