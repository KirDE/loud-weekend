import { expect, test } from "@playwright/test";

const labels = {
  en: {
    summary: "Date filters",
    from: "From",
    to: "Through",
    weekend: "Includes a Saturday or Sunday",
    max: "Maximum festival days",
    copy: "Copy date filter link",
    copied: "Date filter link copied.",
    reset: "Clear all",
    reversed: "The end date must be on or after the start date.",
  },
  de: {
    summary: "Datumsfilter",
    from: "Von",
    to: "Bis einschließlich",
    weekend: "Mit Samstag oder Sonntag",
    max: "Maximale Festivaltage",
    copy: "Link zu Datumsfiltern kopieren",
    copied: "Link zu Datumsfiltern kopiert.",
    reset: "Alles zurücksetzen",
    reversed: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  },
  ru: {
    summary: "Фильтры по датам",
    from: "С",
    to: "По включительно",
    weekend: "Захватывает субботу или воскресенье",
    max: "Максимум дней фестиваля",
    copy: "Скопировать ссылку на фильтры по датам",
    copied: "Ссылка на фильтры по датам скопирована.",
    reset: "Очистить всё",
    reversed: "Дата окончания не может быть раньше даты начала.",
  },
};

for (const [locale, t] of Object.entries(labels)) {
  test(`date controls filter, persist and share without leaking other preferences (${locale})`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/${locale}/`);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    const cards = page.locator(".festivalCard");
    const initialCount = await cards.count();
    expect(initialCount).toBeGreaterThan(0);
    const dates = page.locator(".discoveryDates");
    const summary = dates.getByText(t.summary, { exact: true }).filter({ visible: true });
    await summary.focus();
    await summary.press("Enter");
    const from = dates.getByLabel(t.from, { exact: true });
    const to = dates.getByLabel(t.to, { exact: true });
    await from.fill("2027-06-12");
    await to.fill("2027-06-11");
    await expect(dates.getByText(t.reversed)).toBeVisible();
    await expect(cards).toHaveCount(0);
    await to.fill("2027-06-12");
    await dates.getByLabel(t.weekend, { exact: true }).check();
    await dates.getByLabel(t.max, { exact: true }).fill("2");
    await expect(cards).toHaveCount(0);
    await dates.getByLabel(t.max, { exact: true }).fill("3");
    await expect(cards).toHaveCount(initialCount);
    await page.reload();
    await expect(from).toHaveValue("2027-06-12");
    await expect(to).toHaveValue("2027-06-12");
    await expect(dates.getByLabel(t.weekend, { exact: true })).toBeChecked();
    await expect(dates.getByLabel(t.max, { exact: true })).toHaveValue("3");
    await expect(cards).toHaveCount(initialCount);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(375);
    await page.locator(".search input").fill("private search test");
    await dates.getByRole("button", { name: t.copy }).click();
    await expect(dates.getByRole("status")).toHaveText(t.copied);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(link).search).toBe("?dateFrom=2027-06-12&dateTo=2027-06-12&weekend=1&maxDays=3");

    const clean = await browser.newContext({ baseURL });
    try {
      const recipient = await clean.newPage();
      await recipient.goto(link);
      await expect(recipient.locator(".festivalCard")).toHaveCount(initialCount);
      await expect(
        recipient.locator(".discoveryDates").getByLabel(t.from, { exact: true }),
      ).toHaveValue("2027-06-12");
      await expect
        .poll(() =>
          recipient.evaluate(
            () =>
              JSON.parse(localStorage.getItem("festival-radar-planner-v1"))?.savedFilters.dateFrom,
          ),
        )
        .toBe("");
      await recipient.getByRole("button", { name: t.reset, exact: true }).click();
      await expect(recipient).toHaveURL(new URL(link).origin + `/${locale}/`);
    } finally {
      await clean.close();
    }
  });
}

for (const [locale, t] of Object.entries(labels)) {
  test(`date-only links keep saved filters and restore the URL on Back (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    const key = "festival-radar-planner-v1";
    const saved = { query: "Synthetic", dateFrom: "2027-05-01" };
    await page.addInitScript(
      ({ key, saved }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify({ savedFilters: saved }));
        }
      },
      { key, saved },
    );
    const linkedUrl = `/${locale}/?dateFrom=2027-06-12&ref=festival-guide`;
    await page.goto(linkedUrl);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    const search = page.locator(".search input");
    const from = page.locator(".discoveryDates").getByLabel(t.from, { exact: true });
    await expect(search).toHaveValue(saved.query);
    await expect(from).toHaveValue("2027-06-12");
    await from.fill("2027-07-01");
    await search.fill("Synthetic West");
    await expect(page).toHaveURL(linkedUrl);
    await expect(from).toHaveValue("2027-07-01");

    await page.getByRole("button", { name: t.reset, exact: true }).click();
    await expect(page).toHaveURL(`/${locale}/?ref=festival-guide`);
    await expect(search).toHaveValue(saved.query);
    await expect(from).toHaveValue(saved.dateFrom);
    await expect(search).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(linkedUrl);
    await expect(search).toHaveValue(saved.query);
    await expect(from).toHaveValue("2027-06-12");
    await page.goForward();
    await expect(from).toHaveValue(saved.dateFrom);
    expect(
      await page.evaluate((key) => {
        const { query, dateFrom } = JSON.parse(localStorage.getItem(key)).savedFilters;
        return { query, dateFrom };
      }, key),
    ).toEqual(saved);
  });
}
