import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectReviewedCamping } from "../../lib/ingestion/camping-collector.ts";
import { campingSources, campingSourceUrl } from "../../lib/ingestion/adapters/camping-guidance.ts";
import { importReviewedCamping } from "../../lib/catalog/camping-import.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const actorLabel = "browser-guide-" + randomUUID();
const receipt = {
  actorLabel,
  fingerprint: "a".repeat(64),
  contentHash: "b".repeat(64),
  observedAt: new Date().toISOString(),
};
const year = 2027;
const inputs = await Promise.all(
  Object.keys(campingSources).map(async (slug) => ({
    slug,
    ...campingSources[slug],
    html: await readFile(new URL(`../fixtures/camping/${slug}.html`, import.meta.url), "utf8"),
  })),
);

const collect = (db, input, body = input.html, approval) => {
  const source = campingSourceUrl(input.slug, year);
  return collectReviewedCamping(db, input.slug, year, {
    approval,
    actorLabel,
    fetchImpl: async (url, init) => {
      expect(url).toBe(source);
      expect(init.redirect).toBe("error");
      const response = new Response(body, { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: source });
      return response;
    },
  });
};

test("validated edition camping facts are accessible in every locale", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    for (const record of inputs) {
      const festival = await db.festival.create({
        data: {
          slug: record.slug,
          name: `Edition fixture ${record.city}`,
          city: record.city,
          country: "Fixture country",
          countryCode: record.countryCode,
          officialUrl: `https://www.${record.organizerHost}/`,
          genres: [],
          catalogOrder: 9000,
          editions: {
            create: {
              year,
              status: "TBA",
              ticketStatus: "UNKNOWN",
              recordState: "CURRENT",
              completeness: "TBA",
              sourceUpdatedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      inserted.push(festival.id);
    }

    const previews = await Promise.all(inputs.map((input) => collect(db, input)));
    const campingRecords = previews.map((item) => item.record);
    const first = campingRecords[0];
    const route = `/en/festivals/${first.festivalSlug}/`;
    const before = await browser.newPage();
    try {
      expect(await db.editionCampingFact.count()).toBe(0);
      await before.goto(route);
      await expect(
        before.getByRole("heading", { name: "Camping and on-site facilities" }),
      ).toHaveCount(0);
    } finally {
      await before.close();
    }
    await expect(
      importReviewedCamping(db, { ...first, city: "Wrong city" }, receipt),
    ).rejects.toThrow(/exact catalogue edition/);
    await expect(
      importReviewedCamping(db, { ...first, editionYear: first.editionYear + 1 }, receipt),
    ).rejects.toThrow();
    const dateChange = inputs[0].html.replaceAll("Thursday 5", "Friday 6");
    await expect(collect(db, inputs[0], dateChange, previews[0].fingerprint)).rejects.toThrow(
      /changed since preview/,
    );
    await expect(collect(db, inputs[0], "<html></html>", previews[0].fingerprint)).rejects.toThrow(
      /No complete/,
    );
    expect(await db.editionCampingFact.count()).toBe(0);
    for (const [index, input] of inputs.entries()) {
      await collect(db, input, input.html, previews[index].fingerprint);
    }
    await collect(db, inputs[0], inputs[0].html, previews[0].fingerprint);
    const audit = await db.adminAuditEntry.findMany({
      where: {
        actorLabel,
        resourceKey: first.festivalSlug,
        action: "FESTIVAL_CAMPING_PUBLICATION",
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].evidence).toMatchObject({
      fingerprint: previews[0].fingerprint,
      sourceUrls: [first.sourceUrl],
      editionYear: first.editionYear,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(
      importReviewedCamping(db, { ...first, checkedOn: "2026-01-01" }, receipt),
    ).rejects.toThrow(/more recently reviewed/);

    for (const [lang, heading] of Object.entries({
      en: "Camping and on-site facilities",
      de: "Camping und Ausstattung",
      ru: "Кемпинг и удобства",
    })) {
      const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
      try {
        const page = await context.newPage();
        for (const record of campingRecords) {
          await page.goto(`/${lang}/festivals/${record.festivalSlug}/`);
          const panel = page.getByRole("region", { name: heading });
          await expect(panel.locator("dd")).toHaveCount(record.facts.length);
          await expect(panel.locator(`a[href="${record.sourceUrl}"]`)).toBeVisible();
          await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
          for (const fact of record.facts) {
            if (fact.field === "arrival") {
              await expect(panel.locator(`time[datetime="${fact.earliestDate}"]`)).toBeVisible();
            } else {
              await expect(panel.getByText(fact.description[lang], { exact: true })).toBeVisible();
            }
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
        }
        if (lang === "en") {
          await page.goto(`/festivals/${first.festivalSlug}/`);
          await expect(page.getByRole("region", { name: heading })).toBeVisible();
        }
        await page.goto(`/${lang}/festivals/synthetic-fest/`);
        await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        if (lang === "ru") {
          await db.festivalEdition.updateMany({
            where: { festivalId: inserted[0], year: first.editionYear },
            data: { year: first.editionYear + 1 },
          });
          await page.goto(`/${lang}/festivals/${first.festivalSlug}/`);
          await expect(
            page.getByRole("heading", { name: `Edition fixture ${first.city}`, exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    if (inserted.length) await db.festival.deleteMany({ where: { id: { in: inserted } } });
    await db.$disconnect();
  }
});
