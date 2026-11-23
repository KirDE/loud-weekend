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
  let savedContext;
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
          sourcePerformanceId: "fixture:set-1",
          window: { startsAt: "2027-06-10T18:30:00+02:00", endsAt: "2027-06-10T19:15:00+02:00" },
        },
        {
          ...shared,
          stage: "Second stage",
          start: "18:30",
          artist: "Second Fixture",
          status: "scheduled",
          sourcePerformanceId: "fixture:set-2",
        },
        {
          ...shared,
          stage: "Third stage",
          start: "19:00",
          artist: "Overlap Fixture",
          status: "scheduled",
          sourcePerformanceId: "fixture:set-3",
          window: { startsAt: "2027-06-10T19:00:00+02:00", endsAt: "2027-06-10T19:30:00+02:00" },
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
    savedContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const planPage = await savedContext.newPage();
    const timetable = planPage.getByRole("region", { name: "Stage timetable", exact: true });
    const runningOrder = planPage.getByRole("region", { name: "My running order", exact: true });
    const editionUrl = "/festivals/synthetic-west/2027/";
    await planPage.goto(editionUrl);
    for (const artist of ["First Fixture", "Second Fixture", "Overlap Fixture"]) {
      const toggle = timetable.getByRole("button", { name: `Save to running order: ${artist}` });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
    }
    await expect(
      runningOrder.getByText("Verified overlap: First Fixture / Overlap Fixture"),
    ).toBeVisible();
    await expect(runningOrder.getByText(/no verified end time/)).toBeVisible();
    expect(await planPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await planPage.goto("/en/festivals/synthetic-west/");
    await expect(
      runningOrder.getByText("Verified overlap: First Fixture / Overlap Fixture"),
    ).toBeVisible();
    await planPage.goto(editionUrl);
    await expect(
      runningOrder.getByText("Verified overlap: First Fixture / Overlap Fixture"),
    ).toBeVisible();
    const [identified, ...others] = input.entries;
    const replace = (entry) =>
      importTimetable(db, { ...input, entries: [entry, ...others] }, false);
    await expect(replace({ ...identified, sourcePerformanceId: undefined })).rejects.toThrow(
      "explicit retained or cancelled",
    );
    await expect(replace({ ...identified, artist: "Unrelated Fixture" })).rejects.toThrow(
      "separate identity review",
    );
    await expect(replace({ ...identified, observedAt: "2027-05-31T10:00:00Z" })).rejects.toThrow(
      "older evidence",
    );

    const moved = {
      ...identified,
      stage: "Fourth stage",
      start: "19:30",
      observedAt: "2027-06-02T10:00:00Z",
      window: { startsAt: "2027-06-10T19:30:00+02:00", endsAt: "2027-06-10T20:15:00+02:00" },
    };
    expect((await replace(moved)).changed).toBe(1);
    const readIdentity = () =>
      db.timetablePerformance.findUniqueOrThrow({
        where: {
          editionId_sourcePerformanceId: {
            editionId: edition.id,
            sourcePerformanceId: identified.sourcePerformanceId,
          },
        },
      });
    expect(await readIdentity()).toMatchObject({
      stage: "Fourth stage",
      start: "19:30",
      status: "ANNOUNCED",
    });
    expect(
      (
        await replace({
          ...moved,
          window: undefined,
          status: "cancelled",
          observedAt: "2027-06-03T10:00:00Z",
        })
      ).changed,
    ).toBe(1);
    expect(await readIdentity()).toMatchObject({
      stage: "Fourth stage",
      start: "19:30",
      status: "CANCELLED",
      startsAt: null,
      endsAt: null,
    });
    await expect(replace(moved)).rejects.toThrow("older evidence");
    await planPage.reload();
    await expect(runningOrder.getByText(/First Fixture · Fourth stage.*Cancelled/)).toBeVisible();
    await expect(runningOrder.getByText("Verified overlap:", { exact: false })).toHaveCount(0);
    await runningOrder.getByRole("button", { name: "Clear running order" }).click();
    await expect(runningOrder).toHaveCount(0);
    await planPage.reload();
    await expect(runningOrder).toHaveCount(0);
  } finally {
    await savedContext?.close();
    if (importedEditionId)
      await db.timetablePerformance.deleteMany({ where: { editionId: importedEditionId } });
    await db.$disconnect();
  }
});
