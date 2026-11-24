import { expect, test } from "@playwright/test";

const site = "https://loudweekend.eu";
const expected = {
  en: "Announced festival appearances",
  de: "Angekündigte Festivalauftritte",
  ru: "Объявленные выступления",
};

for (const [language, phrase] of Object.entries(expected)) {
  test(`canonical artist and festival markup comes from the current catalogue (${language})`, async ({
    page,
  }) => {
    await page.goto(`/${language}/artists/sample-artist/`);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toContain(phrase);
    expect(description).toContain("Sample Artist");
    expect(description).toContain("Synthetic");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", `${site}/${language}/artists/sample-artist/`);
    for (const alternate of Object.keys(expected)) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${alternate}"]`)).toHaveAttribute(
        "href",
        `${site}/${alternate}/artists/sample-artist/`,
      );
    }
    await page.goto(`/${language}/artists/second-artist/`);
    const second = await page.locator('meta[name="description"]').getAttribute("content");
    expect(second).toContain("Second Artist");
    expect(second).toContain("Synthetic Fest");
    expect(second).not.toBe(description);

    await page.goto(`/${language}/festivals/synthetic-fest/`);
    const event = JSON.parse(
      await page.locator('script[type="application/ld+json"]').textContent(),
    );
    expect(event.url).toBe(`${site}/${language}/festivals/synthetic-fest/`);
    expect(event["@type"]).toBe("MusicEvent");
    const locality = event.location.address.addressLocality;
    expect(locality).toMatch(/^Sample(?: E2E)? City$/);
    await expect(page.locator(".detailHero .eyebrow")).toHaveText(`DE · ${locality}`);
    expect(event.performer).toContainEqual({ "@type": "MusicGroup", name: "Sample Artist" });
    expect(event.offers).toBeUndefined();
  });
}
