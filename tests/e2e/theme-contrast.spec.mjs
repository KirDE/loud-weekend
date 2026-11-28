import { expect, test } from "@playwright/test";
test.use({ serviceWorkers: "block" });

async function textContrast(locator) {
  return locator.evaluate((element) => {
    const channels = (color) => color.match(/[\d.]+/g).map(Number);
    const luminance = (color) =>
      color.reduce((sum, channel, index) => {
        const value = channel / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const [r, g, b, alpha = 1] = channels(getComputedStyle(node).backgroundColor);
      layers.push({ rgb: [r, g, b], alpha });
      if (alpha === 1) break;
    }
    const background = layers.reduceRight(
      (base, { rgb, alpha }) =>
        rgb.map((value, index) => value * alpha + base[index] * (1 - alpha)),
      [255, 255, 255],
    );
    const colors = [
      luminance(channels(getComputedStyle(element).color).slice(0, 3)),
      luminance(background),
    ];
    return (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
  });
}

for (const language of ["en", "de", "ru"]) {
  test(`${language} card labels and detail notes meet AA contrast in both themes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["light", "dark"]) {
      await page.goto(`/${language}/`);
      await expect(page.locator(".filterBar .search")).toHaveAttribute("data-ready", "true");
      const toggle = page.locator(".themeToggle");
      if (theme === "dark") await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.mouse.move(0, 0);

      const card = page.locator(".festivalCard").first();
      const label = card.locator(".cardFoot b");
      await expect(label).toBeVisible();
      expect.soft(await textContrast(label), `${theme} card label`).toBeGreaterThanOrEqual(4.5);
      const cardLink = card.locator(":scope > a");
      await cardLink.focus();
      await expect(cardLink).toBeFocused();
      await expect
        .poll(() => textContrast(label), { message: `${theme} focused card label` })
        .toBeGreaterThanOrEqual(4.5);

      await page.goto(`/${language}/festivals/synthetic-south/`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const selector of [".sourceNote > p", ".timetableEmpty > span"]) {
        const note = page.locator(selector).first();
        await expect(note).toBeVisible();
        expect.soft(await textContrast(note), `${theme} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}
