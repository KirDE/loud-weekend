import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectReviewedOverview } from "../../lib/ingestion/overview-collector.ts";
import { overviewOrganizer } from "../../lib/ingestion/adapters/festival-overview.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const slug = "hellfest";
const year = 2027;
const source = overviewOrganizer(slug, year);
const actorLabel = `overview-import:e2e-${randomUUID()}`;
const auditWhere = { action: "FESTIVAL_OVERVIEW_PUBLICATION", resourceKey: slug, actorLabel };
const detailPath = (language) => `/${language}/festivals/${slug}/`;

function fixture(stageCount, edition = year) {
  return async (url) => {
    expect(url).toBe(source.url);
    const evidence =
      stageCount === undefined
        ? ""
        : `<h4>Expanding from 2 to ${stageCount} stages and featuring over 42 bands</h4>`;
    const html = `<div class="article"><h1>HELLFEST ${edition} - FIRST INSIGHTS</h1>
      <div class="ck-content">${evidence}</div></div>`;
    const response = new Response(html, { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
}

let festivalId;
test.beforeAll(async () => {
  const festival = await db.festival.create({
    data: {
      slug,
      name: "Fixture Festival",
      country: "France",
      countryCode: source.countryCode,
      city: source.city,
      genres: [],
      officialUrl: new URL(source.url).origin,
      catalogOrder: 9000,
      editions: {
        create: {
          year,
          status: "TBA",
          ticketStatus: "UNKNOWN",
          recordState: "CURRENT",
          completeness: "TBA",
          sourceUpdatedAt: new Date("2026-10-01T00:00:00Z"),
        },
      },
    },
  });
  festivalId = festival.id;
});
test.afterAll(async () => {
  if (festivalId) await db.festival.delete({ where: { id: festivalId } });
  await db.$disconnect();
});

test("preview, evidence changes, absence and edition mismatches do not publish", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "About this festival" });
  const preview = await collectReviewedOverview(db, slug, year, { fetchImpl: fixture(7) });
  await page.goto(detailPath("en"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixture Festival");
  await expect(region).toHaveCount(0);

  for (const fetchImpl of [fixture(), fixture(7, year - 1)]) {
    await expect(
      collectReviewedOverview(db, slug, year, {
        fetchImpl,
        approval: preview.fingerprint,
        actorLabel,
      }),
    ).rejects.toThrow(/No complete organizer overview evidence/);
  }
  await expect(
    collectReviewedOverview(db, slug, year, {
      fetchImpl: fixture(8),
      approval: preview.fingerprint,
      actorLabel,
    }),
  ).rejects.toThrow(/changed since preview/);
  await page.reload();
  await expect(region).toHaveCount(0);

  const next = await collectReviewedOverview(db, slug, year, { fetchImpl: fixture(8) });
  const apply = () =>
    collectReviewedOverview(db, slug, year, {
      fetchImpl: fixture(8),
      approval: next.fingerprint,
      actorLabel,
    });
  expect(await db.adminAuditEntry.count({ where: auditWhere })).toBe(0);
  await expect(
    collectReviewedOverview(db, slug, year, {
      fetchImpl: fixture(8),
      approval: next.fingerprint,
    }),
  ).rejects.toThrow(/actorLabel/);
  await apply();
  await apply();
  const rows = await db.adminAuditEntry.findMany({ where: auditWhere });
  expect(rows).toHaveLength(1);
  expect(rows[0].afterValue).toEqual(next.record);
  expect(rows[0].evidence).toMatchObject({
    fingerprint: next.fingerprint,
    contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    sources: [source.url],
  });
  const revised = await collectReviewedOverview(db, slug, year, { fetchImpl: fixture(9) });
  await collectReviewedOverview(db, slug, year, {
    fetchImpl: fixture(9),
    approval: revised.fingerprint,
    actorLabel,
  });
  const history = await db.adminAuditEntry.findMany({
    where: auditWhere,
    orderBy: { createdAt: "asc" },
  });
  expect(history).toHaveLength(2);
  expect(history[0].id).toBe(rows[0].id);
  expect(history[1].beforeValue.summaryEn).toBe(next.record.summary.en);
  expect(history[1].afterValue).toEqual(revised.record);
  await page.reload();
  await expect(region.getByText(revised.record.summary.en)).toBeVisible();

  await db.festival.update({ where: { id: festivalId }, data: { city: null } });
  try {
    await page.reload();
    await expect(region).toHaveCount(0);
    await expect(apply()).rejects.toThrow(/exact catalogue edition/);
  } finally {
    await db.festival.update({ where: { id: festivalId }, data: { city: source.city } });
  }
});

for (const [lang, heading] of Object.entries({
  en: "About this festival",
  de: "Über dieses Festival",
  ru: "О фестивале",
})) {
  test(`${lang} shows the localized reviewed observation and provenance`, async ({ page }) => {
    const fetchImpl = fixture(8);
    const { record, fingerprint } = await collectReviewedOverview(db, slug, year, { fetchImpl });
    await collectReviewedOverview(db, slug, year, { fetchImpl, approval: fingerprint, actorLabel });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto(detailPath(lang));
    const region = page.getByRole("region", { name: heading });
    await expect(region.getByText(record.summary[lang], { exact: true })).toBeVisible();
    await expect(region.locator(`a[href="${source.url}"]`)).toBeVisible();
    await expect(region.locator("time")).toHaveAttribute("datetime", record.checkedOn);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.goto(`/${lang}/festivals/synthetic-fest/`);
    await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
  });
}
