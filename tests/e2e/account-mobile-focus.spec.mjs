import { expect, test } from "@playwright/test";

const accountNames = { en: "Account", de: "Konto", ru: "Аккаунт" };

for (const [lang, name] of Object.entries(accountNames)) {
  for (const width of [320, 375, 390, 768]) test(`${lang}: account disclosure keyboard flow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "signed out" } }));
    await page.goto(`/${lang}/`);
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const popover = page.getByRole("region", { name, exact: true });
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(popover.getByRole("tab").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Space");
    await expect(popover).toBeVisible();
    const box = await popover.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await popover.locator(".accountClose").click();
    await expect(trigger).toBeFocused();
  });
}
