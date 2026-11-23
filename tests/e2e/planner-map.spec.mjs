import { expect, test } from "@playwright/test";

for (const width of [320, 375, 390, 1280]) {
  test(`map results stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/planner/");
    const map = page.getByRole("group", { name: "Map of Europe with festival locations" });
    const markers = map.locator(".festivalLocationMarker");
    await expect(markers.first()).toBeVisible();
    const marker = markers.first();
    await marker.click();
    await expect(marker).toHaveAttribute("aria-expanded", "true");
    const results = map.locator(".festivalLocationPopup");
    const link = results.getByRole("link").first();
    const route = await link.getAttribute("href");
    expect(route).toMatch(/^\/festivals\/.+\/$/);
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();
    const { x, width: panelWidth } = await results.boundingBox();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + panelWidth).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await link.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${route}$`));
  });
}

test("the discovery map follows the card filters and uses no third-party map requests", async ({
  page,
}) => {
  const base = new URL("/", test.info().project.use.baseURL).origin;
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const external = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== base)
      external.push(new URL(request.url()).hostname);
  });
  await expect(page.locator(".festivalLocationCanvas")).toHaveCount(0);
  const countryFilter = page.locator("select").filter({ has: page.locator('option[value="AT"]') });
  await countryFilter.selectOption("AT");
  await page.getByRole("button", { name: "Show festival map" }).press("Enter");
  const map = page.getByRole("group", { name: "Map of Europe with festival locations" });
  await expect(map).toBeFocused();
  const marker = map.getByRole("button", { name: /Synthetic Alpine.*Approximate location/ });
  await expect(marker).toBeVisible();
  await expect(page.locator(".festivalGrid article")).toHaveCount(1);
  await marker.click();
  await expect(map.getByRole("link", { name: "Synthetic Alpine" })).toBeFocused();

  await countryFilter.selectOption("ES");
  await expect(map.getByRole("link", { name: "Synthetic Alpine" })).toBeHidden();
  await expect(
    map.getByRole("button", { name: /Synthetic South.*Approximate location/ }),
  ).toBeVisible();
  await expect(map.locator(".festivalLocationMarker")).toHaveCount(1);
  await expect(page.locator(".festivalGrid article")).toHaveCount(1);
  expect(external).toEqual([]);
});

test("a failed WebGL initialization leaves the list and its links available", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes("webgl") ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto("/planner/");
  await expect(page.getByText("Map unavailable. Use the festival list below.")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText("Festivals by country (list)", { exact: true }).click();
  await expect(page.locator(".mapTextList").getByRole("link")).toHaveCount(4);
});
