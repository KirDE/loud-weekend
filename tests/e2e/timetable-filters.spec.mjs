import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("published days and stages can be filtered without hiding cancellations or inventing overlaps", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    const edition = await db.festivalEdition.findFirstOrThrow({
      where: { festival: { slug: "synthetic-west" }, year: 2027 }, select: { id: true },
    });
    for (const [day, stage, start, artistName, status] of [
      [10, "Main stage", "18:30", "First Fixture", "ANNOUNCED"],
      [10, "Second stage", "18:30", "Second Fixture", "ANNOUNCED"],
      [11, "Main stage", "20:00", "Cancelled Fixture", "CANCELLED"],
    ]) {
      const row = await db.timetablePerformance.create({
        data: {
          editionId: edition.id, date: new Date(Date.UTC(2027, 5, day)), stage, start, artistName, status,
          timeZone: "Europe/Paris", sourceUrl: "https://festival.example.test/timetable/", observedAt: new Date(),
        },
        select: { id: true },
      });
      inserted.push(row.id);
    }
    for (const [lang, title, dayLabel, stageLabel, zero, cancelled] of [
      ["en", "Stage timetable", "Timetable day", "Timetable stage", "No published slots match these filters.", "Cancelled"],
      ["de", "Bühnenplan", "Tag im Bühnenplan", "Bühne im Bühnenplan", "Keine veröffentlichten Auftritte für diese Filter.", "Abgesagt"],
      ["ru", "Расписание сцен", "День в расписании", "Сцена в расписании", "По этим фильтрам нет опубликованных выступлений.", "Отменено"],
    ]) {
      const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
      try {
        const page = await context.newPage();
        await page.goto(`/${lang}/festivals/synthetic-west/`);
        const timetable = page.getByRole("region", { name: title, exact: true });
        await expect(timetable.getByText("First Fixture", { exact: true })).toBeVisible();
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
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      } finally {
        await context.close();
      }
    }
  } finally {
    if (inserted.length) await db.timetablePerformance.deleteMany({ where: { id: { in: inserted } } });
    await db.$disconnect();
  }
});
