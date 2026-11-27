import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const sourceUrl = "https://festival.example.test/2027/by-day";
const namesakeSlug = "cancelled-sample-artist-namesake";
const day = (date) => new Date(`${date}T00:00:00Z`);
let edition;
let archive;

test.beforeAll(async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  try {
    edition = await db.festivalEdition.findFirstOrThrow({
      where: { year: 2027, festival: { slug: "synthetic-fest" } },
    });
    archive = await db.festivalEdition.create({
      data: {
        festivalId: edition.festivalId,
        year: 2026,
        status: "TBA",
        ticketStatus: "UNKNOWN",
        recordState: "ARCHIVED",
        completeness: "TBA",
        sourceUpdatedAt: day("2026-10-01"),
        snapshotAt: day("2026-10-01"),
      },
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
    await db.artist.create({
      data: {
        slug: namesakeSlug,
        name: artist.name,
        identityState: "UNRESOLVED",
        recentSetlists: [],
        freshness: {},
        appearances: {
          create: { editionId: edition.id, billing: "LINEUP", position: 900, status: "CANCELLED" },
        },
        lineupDays: {
          create: {
            editionId: edition.id,
            dates: [day("2027-06-12")],
            status: "CANCELLED",
            startDate: edition.startDate,
            endDate: edition.endDate,
            sourceUrl,
            observedAt: day("2026-10-02"),
          },
        },
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
    await db.lineupEntry.deleteMany({
      where: { editionId: edition.id, artist: { slug: namesakeSlug } },
    });
    await db.artist.deleteMany({ where: { slug: namesakeSlug } });
    if (archive) await db.festivalEdition.delete({ where: { id: archive.id } });
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
    baseURL,
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
    await expect(panel.getByText(labels[3], { exact: false })).toHaveCount(2);
    await expect(panel.locator(`a[href="${sourceUrl}"]`)).toHaveCount(2);
    const namesakeDay = new Intl.DateTimeFormat(language, {
      dateStyle: "full",
      timeZone: "UTC",
    }).format(day("2027-06-12"));
    const namesake = panel.locator("section").filter({
      has: page.getByRole("heading", { name: namesakeDay, exact: true }),
    });
    await expect(namesake.getByRole("link", { name: "Sample Artist" })).toHaveAttribute(
      "href",
      `/artists/${namesakeSlug}/`,
    );
    const original = panel.locator("section").filter({
      has: page.getByRole("heading", { name: announcedDate, exact: true }),
    });
    await expect(original.getByRole("link", { name: "Sample Artist" })).toHaveAttribute(
      "href",
      "/artists/sample-artist/",
    );
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

    await page
      .context()
      .addCookies([{ name: "festival-radar-language", value: language, url: baseURL }]);
    await page.goto("/festivals/synthetic-fest/2027/");
    await expect(panel.getByRole("heading", { name: announcedDate })).toBeVisible();
    await expect(panel.getByText(labels[3], { exact: false })).toHaveCount(2);
    await expect(panel.locator(`a[href="${sourceUrl}"]`)).toHaveCount(2);
    await expect(namesake.getByRole("link", { name: "Sample Artist" })).toHaveAttribute(
      "href",
      `/artists/${namesakeSlug}/`,
    );
    await expect(original.getByRole("link", { name: "Sample Artist" })).toHaveAttribute(
      "href",
      "/artists/sample-artist/",
    );
    await filter.selectOption("unassigned");
    await expect(panel.getByRole("link", { name: "Sample Artist" })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "Second Artist" })).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320);

    await page.goto("/festivals/synthetic-fest/2026/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Synthetic Fest 2026/ }),
    ).toBeVisible();
    await expect(panel).toHaveCount(0);
  });
}
