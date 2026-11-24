import { expect, test } from "@playwright/test";

const labels = {
  en: {
    share: "Share filters",
    text: "Include search text",
    artists: "Include artists used for sorting",
    copy: "Copy filter link",
    copied: "Filter link copied.",
  },
  de: {
    share: "Filter teilen",
    text: "Suchtext einschließen",
    artists: "Künstler für die Sortierung einschließen",
    copy: "Filterlink kopieren",
    copied: "Filterlink kopiert.",
  },
  ru: {
    share: "Поделиться фильтрами",
    text: "Добавить текст поиска",
    artists: "Добавить исполнителей для сортировки",
    copy: "Скопировать ссылку на фильтры",
    copied: "Ссылка на фильтры скопирована.",
  },
};
const storageKey = "festival-radar-planner-v1";

for (const [locale, t] of Object.entries(labels)) {
  test(`copy only selected search details and restore a localized link (${locale})`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ favoriteArtists: ["artist:second-artist"] }));
    }, storageKey);
    await page.goto(`/${locale}/`);
    const search = page.locator(".search input");
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    await search.fill("Synthetic Fest");
    await page.locator(".discoveryOrder select").selectOption("favorites");
    await expect(page).toHaveURL(`/${locale}/`);
    const share = page.locator("details").filter({ has: page.getByText(t.share, { exact: true }) });
    await share.getByText(t.share, { exact: true }).press("Enter");
    await share.getByRole("button", { name: t.copy }).click();
    await expect(share.getByRole("status")).toHaveText(t.copied);
    const redacted = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(redacted).search).toBe("?filters=1&sort=favorites");
    await share.getByLabel(t.text).check();
    await share.getByLabel(t.artists).check();
    await share.getByRole("button", { name: t.copy }).click();
    await expect(share.getByRole("status")).toHaveText(t.copied);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(link).searchParams.get("q")).toBe("Synthetic Fest");
    expect(new URL(link).searchParams.getAll("artist")).toEqual(["second-artist"]);

    const other = await browser.newContext({ baseURL, viewport: { width: 375, height: 850 } });
    try {
      const recipient = await other.newPage();
      await recipient.addInitScript((key) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(
            key,
            JSON.stringify({ savedFilters: { query: "Synthetic Alpine" } }),
          );
      }, storageKey);
      await recipient.goto(link);
      const recipientSearch = recipient.locator(".search input");
      await expect(recipientSearch).toHaveValue("Synthetic Fest");
      await expect(recipient.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);
      await expect(recipient.locator("link[rel=canonical]")).toHaveAttribute(
        "href",
        new RegExp(`/${locale}/$`),
      );
      await recipientSearch.fill("Synthetic West");
      await expect(recipient).toHaveURL(link);
      await expect
        .poll(() =>
          recipient.evaluate(
            (key) => JSON.parse(localStorage.getItem(key))?.savedFilters?.query,
            storageKey,
          ),
        )
        .toBe("Synthetic Alpine");
      await recipient.locator(".clearFilters").click();
      await expect(recipient).toHaveURL(`/${locale}/`);
      await expect(recipientSearch).toHaveValue("Synthetic Alpine");
      await recipient.goBack();
      await expect(recipientSearch).toHaveValue("Synthetic Fest");
      await recipient.goForward();
      await expect(recipientSearch).toHaveValue("Synthetic Alpine");
      await expect
        .poll(() => recipient.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(375);
    } finally {
      await other.close();
    }
  });
}
