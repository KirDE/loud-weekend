import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";

test("curated guides publish reciprocal locale metadata and display only evidenced editions", async ({
  request,
  page,
}) => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
    !/(?:test|integration)/i.test(databaseUrl.pathname)
  ) {
    throw new Error("A loopback disposable DATABASE_URL is required");
  }
  const db = createPrismaClient();
  let proof;
  try {
    const edition = await db.festivalEdition.findFirstOrThrow({
      where: { festival: { slug: "synthetic-fest" }, year: 2027 },
      select: { id: true },
    });
    proof = await db.editionProvenance.create({
      data: {
        editionId: edition.id,
        field: "dates",
        url: "https://festival.example.test/date",
        note: "Synthetic date fixture",
        checkedAt: new Date(),
      },
      select: { id: true },
    });
    for (const topic of ["germany", "multi-day"]) {
      const variants = ["", "/en", "/de", "/ru"].map((prefix) => `${prefix}/guides/${topic}/`);
      const titles = [];
      for (const path of variants) {
        const response = await request.get(path, { headers: { "user-agent": "Twitterbot/1.0" } });
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain(`rel="canonical" href="https://loudweekend.eu${path}"`);
        expect(html).toContain(
          `hrefLang="x-default" href="https://loudweekend.eu/guides/${topic}/"`,
        );
        for (const lang of ["en", "de", "ru"]) {
          expect(html).toContain(
            `hrefLang="${lang}" href="https://loudweekend.eu/${lang}/guides/${topic}/"`,
          );
        }
        expect(html).toContain('href="/festivals/synthetic-fest/2027/">Synthetic Fest</a>');
        expect(html).not.toContain("Synthetic Alpine");
        titles.push(html.match(/<title>([^<]*)<\/title>/)?.[1]);
      }
      expect(new Set(titles).size).toBe(3);
    }
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const topic of ["germany", "multi-day"])
      for (const prefix of ["", "/en", "/de", "/ru"]) {
        expect(sitemap).toContain(`<loc>https://loudweekend.eu${prefix}/guides/${topic}/</loc>`);
      }
    expect((await request.get("/de/guides/unrecognized/")).status()).toBe(404);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/ru/");
    await page
      .getByRole("navigation", { name: "Гиды по фестивалям" })
      .getByRole("link", { name: "Как спланировать многодневный фестиваль" })
      .click();
    await expect(page).toHaveURL(/\/ru\/guides\/multi-day\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Как спланировать многодневный фестиваль" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Synthetic Fest" })).toHaveAttribute(
      "href",
      "/festivals/synthetic-fest/2027/",
    );
    const originalUrl = page.url();
    await page.getByLabel("Язык", { exact: true }).selectOption("de");
    await expect(
      page.getByRole("heading", { level: 1, name: "Ein mehrtägiges Festival planen" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Synthetic Fest" })).toHaveAttribute(
      "href",
      "/festivals/synthetic-fest/2027/",
    );
    expect(page.url()).toBe(originalUrl);
    await expect(page.getByRole("link", { name: "Zum Festivalkatalog" })).toHaveAttribute(
      "href",
      "/de/",
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  } finally {
    if (proof) await db.editionProvenance.delete({ where: { id: proof.id } });
    await db.$disconnect();
  }
});
