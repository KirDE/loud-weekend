import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const fixture = "edition-history-browser-v2-fixture:";
const slug = "synthetic-history-edition";
const pending = `${fixture}pending`;
const internal = "https://editorial.internal.example.test/private?token=synthetic";

test.beforeAll(async () => {
  const festival = await db.festival.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: "Synthetic History Festival",
      officialUrl: "https://festival.example.test/",
      country: "Germany",
      countryCode: "DE",
      genres: [],
      catalogOrder: 9999,
    },
  });
  for (const year of [2026, 2027]) {
    await db.festivalEdition.upsert({
      where: { festivalId_year: { festivalId: festival.id, year } },
      update: {},
      create: {
        festivalId: festival.id,
        year,
        status: "TBA",
        ticketStatus: "UNKNOWN",
        recordState: year === 2027 ? "CURRENT" : "ARCHIVED",
        completeness: "TBA",
        sourceUpdatedAt: new Date("2026-10-10T08:00:00Z"),
      },
    });
  }
  await db.catalogPublication.createMany({
    data: [
      {
        sourceId: `${fixture}dates`,
        festivalSlug: slug,
        editionYear: 2027,
        fields: ["startDate", "endDate", "operator-secrets"],
        createdAt: new Date("2026-10-08T08:00:00Z"),
      },
      {
        sourceId: `${fixture}tickets`,
        festivalSlug: slug,
        editionYear: 2027,
        fields: ["ticketStatus"],
        createdAt: new Date("2026-10-09T08:00:00Z"),
      },
      {
        sourceId: `${fixture}archive`,
        festivalSlug: slug,
        editionYear: 2026,
        fields: ["timetable"],
        createdAt: new Date("2026-10-10T08:00:00Z"),
      },
      {
        sourceId: `${fixture}another`,
        festivalSlug: "synthetic-alpine",
        editionYear: 2027,
        fields: ["lineup"],
        createdAt: new Date("2026-10-10T08:00:00Z"),
      },
    ].map((row) => ({
      ...row,
      source: "ADMIN",
      actorLabel: "private fixture editor",
      evidence: { sourceUrl: internal, pending, notes: "private fixture notes" },
    })),
    skipDuplicates: true,
  });
  await db.adminChange.upsert({
    where: { id: pending },
    update: {},
    create: {
      id: pending,
      resourceKind: "FESTIVAL",
      resourceKey: slug,
      field: "lineup",
      baseRevision: 0,
      beforeValue: [],
      afterValue: ["Private pending artist"],
      sourceEvidence: { sourceUrl: internal },
    },
  });
});
test.afterAll(async () => {
  await db.festival.deleteMany({ where: { slug } });
  await db.adminChange.deleteMany({ where: { id: pending } });
  // Publications are append-only. Their dedicated fixture slug is no longer public.
  await db.$disconnect();
});

const locales = {
  en: ["Published changes", "Dates updated", "Ticket information updated"],
  de: ["Veröffentlichte Änderungen", "Termine aktualisiert", "Ticketinformationen aktualisiert"],
  ru: ["Опубликованные изменения", "Даты обновлены", "Информация о билетах обновлена"],
};

for (const [language, [title, dates, tickets]] of Object.entries(locales)) {
  test(`history is edition-scoped, localized, ordered and redacted (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const response = await page.goto(`/${language}/festivals/${slug}/`);
    const history = page.getByRole("region", { name: title });
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(history.getByRole("listitem").nth(0)).toContainText(tickets);
    await expect(history.getByRole("listitem").nth(1)).toContainText(dates);
    await expect(history.locator("time").nth(0)).toHaveAttribute(
      "datetime",
      "2026-10-09T08:00:00.000Z",
    );
    const html = await response.text();
    for (const entry of [
      internal,
      "private fixture editor",
      "private fixture notes",
      "Private pending artist",
      "operator-secrets",
      fixture,
    ]) {
      expect(html).not.toContain(entry);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
}

test("the archive and the empty edition never inherit another edition’s changes", async ({
  page,
}) => {
  await page.goto(`/festivals/${slug}/2026/`);
  await expect(
    page.getByRole("region", { name: "Published changes" }).getByRole("listitem"),
  ).toHaveText(/Timetable updated/);
  await page.goto("/festivals/synthetic-south/");
  await expect(page.getByText("No published changes recorded for this edition.")).toBeVisible();
});
