import { expect, test } from "@playwright/test";

test("restored month stays visible and clearable on a catalogue subset", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("festival-radar-planner-v1", JSON.stringify({ favoriteFestivals: [], favoriteArtists: [], attendance: {}, playlistFestivals: [], savedFilters: { query: "", country: "all", month: "03", announcedOnly: false, ticketsOnly: false } }));
  });
  await page.goto("/countries/es/");
  await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
  const month = page.getByRole("combobox", { name: "Filter by month", exact: true });
  await expect(month).toHaveValue("03");
  await expect(month.locator("option:checked")).toHaveText("March");
  await expect(page.locator(".festivalCard")).toHaveCount(0);
  await month.selectOption("all");
  await expect(page.locator(".festivalCard")).toHaveCount(1);
});
