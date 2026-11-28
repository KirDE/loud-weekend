import { expect, test } from "@playwright/test";

const labels = {
  en: {
    artists: "Artist profiles",
    festivals: "Festival pages",
    empty: "No catalogue suggestions. The plain festival search is still active.",
  },
  de: {
    artists: "Künstlerprofile",
    festivals: "Festivalseiten",
    empty: "Keine Katalogvorschläge. Die normale Festivalsuche bleibt aktiv.",
  },
  ru: {
    artists: "Профили исполнителей",
    festivals: "Страницы фестивалей",
    empty: "Нет подсказок из каталога. Обычный поиск фестивалей продолжает работать.",
  },
};
for (const [locale, t] of Object.entries(labels)) {
  test(`keyboard opens canonical catalogue suggestions without replacing plain search (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(`/${locale}/`);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    const search = page.locator(".search input");
    const panel = page.locator(".discoverySuggestions");
    await search.fill("zzzz nonexistent");
    await expect(panel.getByRole("status")).toHaveText(t.empty);
    await expect(page.locator(".festivalCard")).toHaveCount(0);
    await search.fill("synthetic fest");
    const festival = panel
      .getByRole("region", { name: t.festivals })
      .getByRole("link", { name: /Synthetic Fest/ });
    await expect(festival).toBeVisible();
    await expect(festival).toHaveAttribute("href", "/festivals/synthetic-fest/2027/");
    await search.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);
    await search.click();
    await expect(panel.getByRole("region", { name: t.festivals })).toBeVisible();
    await search.press("Escape");
    await expect(panel).toHaveCount(0);
    await search.press("ArrowDown");
    await expect(
      panel
        .getByRole("region", { name: t.festivals })
        .getByRole("link", { name: /Synthetic Fest/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
    await expect(panel).toHaveCount(0);
    await search.fill("sample city");
    const city = panel.getByRole("button", { name: "Sample City · AT", exact: true });
    await expect(city).toBeVisible();
    await expect(city).toHaveCSS("display", "block");
    await expect
      .poll(() =>
        city.evaluate((button) => button.offsetWidth === button.parentElement.clientWidth),
      )
      .toBe(true);
    await search.fill("secod artist");
    const artist = panel
      .getByRole("region", { name: t.artists })
      .getByRole("link", { name: "Second Artist", exact: true });
    await expect(artist).toHaveAttribute("href", "/artists/second-artist/");
    await search.press("ArrowDown");
    await expect(artist).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await artist.press("Enter");
    await expect(page).toHaveURL("/artists/second-artist/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second Artist");
  });
}

test("composition keys remain available to the input method", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
  const search = page.locator(".search input");
  const suggestion = page
    .locator(".discoverySuggestions")
    .getByRole("link", { name: /Synthetic Fest/ });
  await search.fill("synthetic fest");
  await expect(suggestion).toBeVisible();

  const keyWasHandled = (key) =>
    search.evaluate(
      (input, key) =>
        !input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            isComposing: true,
          }),
        ),
      key,
    );
  expect(await keyWasHandled("ArrowDown")).toBe(false);
  await expect(search).toBeFocused();
  expect(await keyWasHandled("Escape")).toBe(false);
  await expect(suggestion).toBeVisible();

  await search.press("ArrowDown");
  await expect(suggestion).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  await expect(suggestion).toHaveCount(0);
});

test("ArrowDown can open suggestions before the typing debounce completes", async ({ page }) => {
  // Own the app's timers from startup; installing after hydration mixes real
  // debounce timers with the fake clearTimeout implementation.
  await page.clock.install();
  await page.goto("/en/");
  await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
  const search = page.locator(".search input");
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await search.fill("synthetic fest");
  const suggestion = page
    .locator(".discoverySuggestions")
    .getByRole("link", { name: /Synthetic Fest/ });
  await expect(suggestion).toHaveCount(0);
  await search.press("ArrowDown");
  await expect(suggestion).toBeFocused();
});
