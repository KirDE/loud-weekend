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
    await expect(link).toHaveAttribute("href", /^\/festivals\/[^/]+\/2027\/$/);
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
      "/festivals/synthetic-alpine/2027/",
    );
  });
