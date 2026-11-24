import { expect, test } from "@playwright/test";

const labels = {
  en: {
    picker: "Match artists",
    search: "Find an announced artist",
    mode: "Match mode",
    share: "Share filters",
    copy: "Copy filter link",
  },
  de: {
    picker: "Nach Künstlern filtern",
    search: "Angekündigten Künstler finden",
    mode: "Übereinstimmung",
    share: "Filter teilen",
    copy: "Filterlink kopieren",
  },
  ru: {
    picker: "Фильтр по исполнителям",
    search: "Найти объявленного исполнителя",
    mode: "Режим совпадения",
    share: "Поделиться фильтрами",
    copy: "Скопировать ссылку на фильтры",
  },
};

for (const [locale, t] of Object.entries(labels)) {
  test(`use and share favorite artist matches (${locale})`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ favoriteArtists: ["artist:second-artist"] }));
    });
    await page.goto(`/${locale}/`);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    const picker = page.locator(".discoveryArtistPicker");
    await picker.getByText(t.picker, { exact: true }).press("Enter");
    const search = picker.getByRole("searchbox", { name: t.search });
    await picker.getByRole("button", { name: "Second Artist", exact: true }).press("Enter");
    await expect(search).toBeFocused();
    await search.fill("Sample");
    await picker.getByRole("button", { name: "Sample Artist", exact: true }).press("Enter");
    await expect(search).toBeFocused();
    const cards = page.locator(".festivalCard h2");
    await expect(cards).toHaveText(["Synthetic Fest"]);
    await expect(page.locator(".artistMatchSummary")).toContainText("Second Artist, Sample Artist");
    await picker.getByRole("combobox", { name: t.mode }).selectOption("any");
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toHaveText("Synthetic Fest");
    await page.reload();
    await expect(picker.getByRole("combobox", { name: t.mode })).toHaveValue("any");
    const share = page.locator("details").filter({ has: page.getByText(t.share, { exact: true }) });
    await share.getByText(t.share, { exact: true }).press("Enter");
    await share.getByRole("button", { name: t.copy, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("matchArtist=sample-artist");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const url = new URL(link);
    expect(url.searchParams.getAll("matchArtist")).toEqual(["sample-artist", "second-artist"]);
    expect(url.searchParams.getAll("artist")).toEqual([]);

    const recipient = await browser.newContext({ baseURL });
    try {
      const other = await recipient.newPage();
      await other.goto(link);
      await expect(other.locator(".festivalCard h2").first()).toHaveText("Synthetic Fest");
      await expect(other.locator(".festivalCard")).toHaveCount(4);
      await expect(
        other.locator(".discoveryArtistPicker").getByRole("combobox", { name: t.mode }),
      ).toHaveValue("any");
    } finally {
      await recipient.close();
    }
    await picker.locator("ul").first().getByRole("button").first().press("Enter");
    await expect(search).toBeFocused();
    await picker.locator("ul").first().getByRole("button").first().press("Enter");
    await expect(picker.locator("summary")).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  });
}
