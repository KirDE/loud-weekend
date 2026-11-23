import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { importTimetable } from "../../lib/catalog/timetable-import.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("published days and stages can be filtered without hiding cancellations or inventing overlaps", async ({
  browser,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  let importedEditionId;
  try {
    const edition = await db.festivalEdition.findFirstOrThrow({
      where: { festival: { slug: "synthetic-west" }, year: 2027 },
      select: {
        id: true,
        festival: { select: { officialUrl: true } },
        _count: { select: { timetable: true } },
      },
    });
    expect(edition._count.timetable).toBe(0);
    const shared = {
      date: "2027-06-10",
      timeZone: "Europe/Paris",
      sourceUrl: new URL("/timetable/", edition.festival.officialUrl).href,
      observedAt: "2027-06-01T10:00:00Z",
    };
    const input = {
      festivalSlug: "synthetic-west",
      editionYear: 2027,
      entries: [
        {
          ...shared,
          stage: "Main stage",
          start: "18:30",
          artist: "First Fixture",
          status: "scheduled",
          window: { startsAt: "2027-06-10T18:30:00+02:00", endsAt: "2027-06-10T19:15:00+02:00" },
        },
        {
          ...shared,
          stage: "Second stage",
          start: "18:30",
          artist: "Second Fixture",
          status: "scheduled",
        },
        {
          ...shared,
          stage: "Main stage",
          date: "2027-06-11",
          start: "20:00",
          artist: "Cancelled Fixture",
          status: "cancelled",
        },
      ],
    };
    expect((await importTimetable(db, input, true)).changed).toBe(1);
    expect(await db.timetablePerformance.count({ where: { editionId: edition.id } })).toBe(0);
    expect((await importTimetable(db, input, false)).changed).toBe(1);
    importedEditionId = edition.id;
    expect((await importTimetable(db, input, false)).changed).toBe(0);
    for (const [lang, title, dayLabel, stageLabel, zero, cancelled] of [
      [
        "en",
        "Stage timetable",
        "Timetable day",
        "Timetable stage",
        "No published slots match these filters.",
        "Cancelled",
      ],
      [
        "de",
        "Bühnenplan",
        "Tag im Bühnenplan",
        "Bühne im Bühnenplan",
        "Keine veröffentlichten Auftritte für diese Filter.",
        "Abgesagt",
      ],
      [
        "ru",
        "Расписание сцен",
        "День в расписании",
        "Сцена в расписании",
        "По этим фильтрам нет опубликованных выступлений.",
        "Отменено",
      ],
    ]) {
      const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
      try {
        const page = await context.newPage();
        await page.goto(`/${lang}/festivals/synthetic-west/`);
        const timetable = page.getByRole("region", { name: title, exact: true });
        await expect(timetable.getByText("First Fixture", { exact: true })).toBeVisible();
        const first = timetable.getByRole("listitem").filter({ hasText: "First Fixture" });
        const second = timetable.getByRole("listitem").filter({ hasText: "Second Fixture" });
        await expect(first.locator("time")).toHaveText(["18:30", "19:15"]);
        await expect(first.locator("time").last()).toHaveAttribute(
          "datetime",
          "2027-06-10T17:15:00.000Z",
        );
        await expect(second.locator("time")).toHaveText(["18:30"]);
        await expect(timetable.getByRole("alert")).toHaveCount(0);
        const day = timetable.getByRole("combobox", { name: dayLabel, exact: true });
        const stage = timetable.getByRole("combobox", { name: stageLabel, exact: true });
        await day.selectOption("2027-06-11");
        await expect(timetable.getByText(cancelled, { exact: true })).toBeVisible();
        await expect(timetable.getByText("First Fixture", { exact: true })).toHaveCount(0);
        await stage.selectOption("Second stage");
        await expect(timetable.getByRole("status")).toHaveText(zero);
        await day.selectOption("");
        await expect(timetable.getByText("Second Fixture", { exact: true })).toBeVisible();
        await expect(timetable.getByText(cancelled, { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          320,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    if (importedEditionId)
      await db.timetablePerformance.deleteMany({ where: { editionId: importedEditionId } });
    await db.$disconnect();
  }
});
