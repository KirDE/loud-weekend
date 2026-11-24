import { test, expect } from "@playwright/test";

const labels = {
  en: "Download account data (JSON)",
  de: "Kontodaten herunterladen (JSON)",
  ru: "Скачать данные аккаунта (JSON)",
};

for (const [locale, label] of Object.entries(labels)) {
  test(`account menu downloads the archive in ${locale}`, async ({ page }) => {
    const email = "synthetic-export@example.test";
    await page.route("**/api/auth/me**", (route) =>
      route.fulfill({ json: { user: { id: "synthetic", email } } }),
    );
    await page.route("**/api/auth/export**", (route) => {
      expect(route.request().method()).toBe("POST");
      return route.fulfill({
        json: { version: 1 },
        headers: { "Content-Disposition": 'attachment; filename="loud-weekend-account-data.json"' },
      });
    });
    await page.goto(`/${locale}/`);
    await page.getByRole("button", { name: email, exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await download).suggestedFilename()).toBe("loud-weekend-account-data.json");
  });
}
