import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const storageKey = "festival-radar-planner-v1";
const legacyFilters = {
  query: "Synthetic",
  country: "DE",
  month: "06",
  announcedOnly: true,
  ticketsOnly: false,
};
const activeFilters = {
  ...legacyFilters,
  ticketsOnly: true,
  genre: "doom metal",
  origin: "cologne",
  maxDistance: "500",
};

async function expectFilters(page, filters) {
  await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByRole("textbox", { name: "Search festivals, artists or cities" }),
  ).toHaveValue(filters.query);
  const expectedSelects = {
    countries: filters.country,
    "Filter by month": filters.month,
    "Filter by genre": filters.genre,
    "Distance origin": filters.origin,
    "Maximum distance": filters.maxDistance,
  };
  for (const [name, value] of Object.entries(expectedSelects)) {
    await expect(page.getByRole("combobox", { name, exact: true })).toHaveValue(value);
  }
  await expect(page.locator(".filterToggles input").nth(0)).toBeChecked({
    checked: filters.announcedOnly,
  });
  await expect(page.locator(".filterToggles input").nth(1)).toBeChecked({
    checked: filters.ticketsOnly,
  });
}

test("legacy discovery filters migrate, persist and sync to an independent browser context", async ({
  page,
  browser,
  baseURL,
}) => {
  const credentials = {
    email: `discovery-${randomUUID()}@example.test`,
    password: "synthetic discovery test password",
  };
  await page.addInitScript(
    ({ key, filters }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ savedFilters: filters }));
    },
    { key: storageKey, filters: legacyFilters },
  );
  await page.goto("/en/");
  await expectFilters(page, {
    ...legacyFilters,
    genre: "all",
    origin: "berlin",
    maxDistance: "all",
  });
  await expect(page.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);

  await page.getByRole("combobox", { name: "Filter by genre" }).selectOption(activeFilters.genre);
  await page.getByRole("combobox", { name: "Distance origin" }).selectOption(activeFilters.origin);
  await page
    .getByRole("combobox", { name: "Maximum distance" })
    .selectOption(activeFilters.maxDistance);
  await expect(page.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);
  await page.getByText("Official tickets only", { exact: true }).click();
  await expect(page.locator(".festivalCard")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)).savedFilters, storageKey),
    )
    .toEqual(activeFilters);
  await page.reload();
  await expectFilters(page, activeFilters);
  await expect(page.locator(".festivalCard")).toHaveCount(0);

  expect((await page.request.post("/api/auth/register", { data: credentials })).status()).toBe(201);
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Everything is synchronized.")).toBeVisible();
  const document = await page.request.get("/api/sync/saved-filters/");
  expect((await document.json()).document.payload.savedFilters).toEqual(activeFilters);

  const secondDevice = await browser.newContext({ baseURL });
  try {
    const secondPage = await secondDevice.newPage();
    expect((await secondPage.request.post("/api/auth/login", { data: credentials })).ok()).toBe(
      true,
    );
    await secondPage.goto("/en/planner/");
    await secondPage
      .getByRole("button", { name: "Use account data on this device", exact: true })
      .click();
    await expect(secondPage.getByText("Everything is synchronized.")).toBeVisible();
    await secondPage.goto("/en/");
    await expectFilters(secondPage, activeFilters);
    await expect(secondPage.locator(".festivalCard")).toHaveCount(0);
    await secondPage.goto("/de/");
    await expect
      .poll(() =>
        secondPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).savedFilters,
          storageKey,
        ),
      )
      .toEqual(activeFilters);
    await expect(secondPage.locator(".festivalCard")).toHaveCount(0);
  } finally {
    await secondDevice.close();
  }
});
