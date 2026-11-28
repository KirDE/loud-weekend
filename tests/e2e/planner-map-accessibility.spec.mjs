import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const labels = {
  en: { region: "Festival map", list: "Festivals by country (list)" },
  de: { region: "Festivalkarte", list: "Festivals nach Land (Liste)" },
  ru: { region: "Карта фестивалей", list: "Фестивали по странам (список)" },
};

for (const [lang, t] of Object.entries(labels))
  test(`${lang}: map disclosures expose keyboard-operable links and a complete list`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: lang === "en" ? 768 : lang === "de" ? 375 : 320,
      height: 844,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${lang}/planner/`);
    const region = page.getByRole("region", { name: t.region });
    const map = region.getByRole("group", { name: /Europe|Europa|Европы/i });
    const marker = map.locator(".festivalLocationMarker").first();
    const results = map.locator(".festivalLocationPopup");
    const link = results.getByRole("link").first();
    await expect(marker).toHaveAttribute("aria-expanded", "false");
    await expect(link).toHaveCount(0);

    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(link).toBeFocused();
    await expect(marker).toHaveAttribute("aria-expanded", "true");
    const audit = await new AxeBuilder({ page })
      .include(".festivalLocationMap")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await info.attach("map-axe", {
      body: JSON.stringify(audit.violations, null, 2),
      contentType: "application/json",
    });
    expect(
      audit.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(marker).toBeFocused();
    await expect(link).toHaveCount(0);

    const list = region.locator(".mapTextList");
    const toggle = list.getByText(t.list, { exact: true });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(list.getByRole("link")).toHaveCount(4);
    const listAudit = await new AxeBuilder({ page })
      .include(".mapTextList")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await info.attach("map-list-axe", {
      body: JSON.stringify(listAudit.violations, null, 2),
      contentType: "application/json",
    });
    expect(listAudit.violations.map(({ id }) => id)).toEqual([]);
    await expect(list.getByRole("link", { name: /Synthetic Alpine/ })).toHaveAttribute(
      "href",
      "/festivals/synthetic-alpine/",
    );
  });

const panLabels = {
  en: ["Pan map left", "Pan map right", "Pan map up", "Pan map down", "Fit festival locations"],
  de: [
    "Karte nach links verschieben",
    "Karte nach rechts verschieben",
    "Karte nach oben verschieben",
    "Karte nach unten verschieben",
    "Festivalstandorte einpassen",
  ],
  ru: [
    "Сдвинуть карту влево",
    "Сдвинуть карту вправо",
    "Сдвинуть карту вверх",
    "Сдвинуть карту вниз",
    "Показать все места фестивалей",
  ],
};

for (const [lang, [left, right, up, down, fit]] of Object.entries(panLabels)) {
  test(`${lang}: move the map without dragging at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/${lang}/`);
    const countryFilter = page
      .locator("select")
      .filter({ has: page.locator('option[value="AT"]') });
    await countryFilter.selectOption("AT");
    await page.locator(".festivalLocationMap > button").press("Enter");
    const map = page.locator(".festivalLocationMap");
    const marker = map.locator(".festivalLocationMarker");
    await expect(marker).toBeVisible();
    const position = () =>
      marker.evaluate((element) => [parseFloat(element.style.left), parseFloat(element.style.top)]);
    const [startX, startY] = await position();
    for (const [name, key, axis, direction] of [
      [left, "Enter", 0, -1],
      [right, null, 0, 1],
      [up, "Enter", 1, -1],
      [down, "Space", 1, 1],
    ]) {
      const button = map.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible({ timeout: 2500 });
      const before = (await position())[axis];
      if (key) {
        await button.press(key);
        await expect(button).toBeFocused();
      } else {
        await button.click();
      }
      await expect
        .poll(async () => ((await position())[axis] - before) * direction)
        .toBeGreaterThan(20);
    }
    await map.getByRole("button", { name: fit, exact: true }).press("Enter");
    await expect
      .poll(async () => {
        const [x, y] = await position();
        return Math.hypot(x - startX, y - startY);
      })
      .toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
}
