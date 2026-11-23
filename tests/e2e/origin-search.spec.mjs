import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const endpoint = "/api/locations/search/";
const countryCode = "DE";
const rows = [
  {
    id: "origin-stuttgart",
    name: "Stuttgart",
    searchName: "stuttgart",
    region: "Baden-Württemberg",
    latitude: 48.78,
    longitude: 9.18,
  },
  {
    id: "origin-small-town",
    name: "Münsingen",
    searchName: "munsingen",
    region: "Baden-Württemberg",
    latitude: 48.41,
    longitude: 9.5,
  },
  {
    id: "origin-postal",
    name: "Münsingen",
    searchName: "munsingen",
    region: "Baden-Württemberg",
    postalCode: "72525",
    postalKey: "72525",
    latitude: 48.41,
    longitude: 9.5,
  },
];
test.beforeAll(async () => {
  await db.geographicOrigin.createMany({ data: rows.map((row) => ({ ...row, countryCode })) });
});
test.afterAll(async () => {
  await db.geographicOrigin.deleteMany({ where: { id: { in: rows.map(({ id }) => id) } } });
  await db.$disconnect();
});

for (const [lang, labels] of Object.entries({
  en: ["Find another origin", "City or postal code", "Find places", "No matches"],
  de: ["Anderen Startort finden", "Ort oder Postleitzahl", "Orte suchen", "Keine Treffer"],
  ru: [
    "Найти другой пункт отправления",
    "Город или почтовый индекс",
    "Найти места",
    "Ничего не найдено",
  ],
})) {
  test(`${lang} searches indexed cities and postal codes, then restores the selected origin`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto(`/${lang}/`);
    await page.getByText(labels[0], { exact: true }).click();
    const input = page.getByRole("searchbox", { name: labels[1] });
    await expect
      .poll(() =>
        input.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps")),
        ),
      )
      .toBe(true);
    await input.fill("stuttgart");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: /Stuttgart/ })).toBeVisible();
    await input.fill("Munsing");
    await page.getByRole("button", { name: labels[2] }).click();
    await expect(page.getByRole("button", { name: /Münsingen/ })).toBeVisible();
    await input.fill("72525");
    await input.press("Enter");
    await page.getByRole("button", { name: /Münsingen, 72525/ }).click();
    await expect(page.locator('.filterBar select option[value="custom"]')).toContainText(
      "Münsingen",
    );
    await page.reload();
    await expect(page.locator('.filterBar select option[value="custom"]')).toContainText(
      "Münsingen",
    );
    await page.getByText(labels[0], { exact: true }).click();
    await input.fill("no-match");
    await input.press("Enter");
    await expect(page.getByText(labels[3], { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
}

test("search uses same-origin POST and distinguishes missing index from no match", async ({
  request,
  baseURL,
}) => {
  const data = { query: "unknown", countryCode };
  const foreign = await request.post(endpoint, {
    headers: { Origin: "https://other.example.test" },
    data,
  });
  expect(foreign.status()).toBe(403);
  const empty = await request.post(endpoint, { headers: { Origin: baseURL }, data });
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toEqual({ available: true, places: [] });
  const unavailable = await request.post(endpoint, {
    headers: { Origin: baseURL },
    data: { ...data, countryCode: "ZZ" },
  });
  expect(unavailable.status()).toBe(503);
});
