import { expect, test } from "@playwright/test";

const localized = {
  en: ["My artists", "Find an artist to save", "No favorite artists yet."],
  de: [
    "Meine Künstler",
    "Künstler zum Speichern suchen",
    "Noch keine Lieblingskünstler gespeichert.",
  ],
  ru: ["Мои артисты", "Найти артиста для сохранения", "Любимых артистов пока нет."],
};

for (const [locale, [title, search, empty]] of Object.entries(localized)) {
  test(`favorite artist appears once per current edition and survives a reload (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/planner/`);
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(empty)).toBeVisible();
    await page.getByRole("searchbox", { name: search }).fill("Second Artist");
    const result = page
      .locator("section")
      .filter({ has: page.getByRole("searchbox") })
      .getByRole("button");
    await result.click();
    await expect(result).toHaveAttribute("aria-pressed", "true");
    const heading = page.getByRole("heading", { name: "Second Artist" });
    const saved = page.locator("article").filter({ has: heading });
    await expect(saved.getByRole("link", { name: "Synthetic Fest · 2027" })).toHaveCount(1);
    await expect(saved.getByRole("link", { name: /Synthetic Alpine/ })).toHaveCount(0);
    await expect(saved.getByRole("link", { name: "Second Artist" })).toHaveAttribute(
      "href",
      `/${locale}/artists/second-artist/`,
    );
    await page.reload();
    await expect(saved).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await saved.getByRole("button").click();
    await expect(page.getByText(empty)).toBeVisible();
  });
}

test("legacy names and canonical favorites read back once from explicit account sync", async ({
  page,
}) => {
  await page.route("**/api/auth/me**", (route) =>
    route.fulfill({
      json: {
        user: { id: "fixture", email: "fixture@example.test", emailVerified: true, role: "USER" },
      },
    }),
  );
  await page.route("**/api/sync/**", (route) =>
    route.fulfill({
      json: {
        document: route.request().url().includes("/favorites")
          ? {
              id: "favorites",
              revision: 1,
              updatedAt: "2026-01-01T00:00:00.000Z",
              payload: {
                favoriteFestivals: [],
                favoriteArtists: ["Second Artist", "artist:second-artist"],
              },
            }
          : null,
      },
    }),
  );
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Use account data on this device" }).click();
  await page.getByRole("link", { name: "My artists", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Second Artist", exact: true })).toHaveCount(1);
  await page.getByRole("link", { name: "Second Artist", exact: true }).click();
  await expect(page.locator(".artistToolbar button")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".artistToolbar button").click();
  await page.goBack();
  await expect(page.getByText("No favorite artists yet.")).toBeVisible();
});
