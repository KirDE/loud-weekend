import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const sourceUrl = "https://festival.example.test/2027/by-day";
const day = (date) => new Date(`${date}T00:00:00Z`);
let edition;

test.beforeAll(async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  try {
    edition = await db.festivalEdition.findFirstOrThrow({
      where: { year: 2027, festival: { slug: "synthetic-fest" } },
    });
    const artist = await db.artist.findUniqueOrThrow({ where: { slug: "sample-artist" } });
    await db.editionLineupDayAllocation.create({
      data: {
        editionId: edition.id,
        artistId: artist.id,
        dates: [day("2027-06-11")],
        status: "CANCELLED",
        startDate: edition.startDate,
        endDate: edition.endDate,
        sourceUrl,
        observedAt: day("2026-10-02"),
      },
    });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  if (!edition) return;
  const db = createPrismaClient();
  try {
    await db.editionLineupDayAllocation.deleteMany({ where: { editionId: edition.id, sourceUrl } });
  } finally {
    await db.$disconnect();
  }
});

for (const [language, labels] of Object.entries({
  en: ["Lineup by day", "Show lineup day", "Day not announced", "Cancelled"],
  de: ["Line-up nach Tagen", "Line-up-Tag anzeigen", "Tag nicht angekündigt", "Abgesagt"],
  ru: ["Лайнап по дням", "День выступления", "День не объявлен", "Отменено"],
})) {
  test(`${language} shows verified days independently of a timetable at 320px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto(`/${language}/festivals/synthetic-fest/`);
    const panel = page.getByRole("region", { name: labels[0] });
    const filter = panel.getByRole("combobox", { name: labels[1] });
    await expect(panel.getByRole("heading", { name: labels[2] })).toBeVisible();
    const announcedDate = new Intl.DateTimeFormat(language, {
      dateStyle: "full",
      timeZone: "UTC",
    }).format(day("2027-06-11"));
    await expect(panel.getByRole("heading", { name: announcedDate })).toBeVisible();
    await expect(panel.getByText(labels[3], { exact: false })).toBeVisible();
    await expect(panel.locator(`a[href="${sourceUrl}"]`)).toBeVisible();
    await expect(panel.getByRole("link", { name: "Sample Artist" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Second Artist" })).toBeVisible();
    await expect(page.locator(".timetableEmpty")).toBeVisible();
    await expect
      .poll(() =>
        filter.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps")),
        ),
      )
      .toBe(true);
    await filter.focus();
    await filter.press("ArrowDown");
    await expect(filter).toHaveValue("2027-06-11");
    await expect(panel.getByRole("link", { name: "Second Artist" })).toHaveCount(0);
    await filter.selectOption("unassigned");
    await expect(panel.getByRole("link", { name: "Sample Artist" })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "Second Artist" })).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320);
  });
}
