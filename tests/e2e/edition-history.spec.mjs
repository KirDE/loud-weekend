import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const fixture = `edition-history-browser-v2-fixture:${process.pid}:`;
const slug = `synthetic-history-edition-${process.pid}`;
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
        fields: ["ticketStatus", "status"],
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
        sourceId: "edition-history-browser-v2-fixture:another",
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
    await expect(history.getByRole("listitem").nth(0)).toContainText(
      {
        en: "Edition status updated",
        de: "Status der Ausgabe aktualisiert",
        ru: "Статус выпуска обновлён",
      }[language],
    );
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

const announcements = {
  en: [
    "Festival announcements",
    "Country",
    "Period",
    "Apply filters",
    "No published changes match these filters.",
  ],
  de: [
    "Festivalmeldungen",
    "Land",
    "Zeitraum",
    "Filter anwenden",
    "Keine veröffentlichten Änderungen entsprechen diesen Filtern.",
  ],
  ru: [
    "Новости фестивалей",
    "Страна",
    "Период",
    "Применить фильтры",
    "Нет опубликованных изменений по этим фильтрам.",
  ],
};

for (const [language, [heading, country, period, apply, empty]] of Object.entries(announcements)) {
  test(`announcement timeline is discoverable, localized, exact-edition and redacted (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${language}/festivals/${slug}/`);
    await page.getByRole("link", { name: heading }).click();
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: heading })).toBeVisible();
    await expect(
      main.locator("ol > li").filter({ hasText: "Synthetic History Festival" }),
    ).toHaveCount(3);
    await expect(
      main.getByRole("link", { name: "Synthetic History Festival 2026" }),
    ).toHaveAttribute("href", `/festivals/${slug}/2026/`);
    await expect(main.getByRole("link", { name: "Synthetic Alpine 2027" })).toBeVisible();
    const html = await page.content();
    for (const privateValue of [
      internal,
      "private fixture editor",
      "private fixture notes",
      "Private pending artist",
      "operator-secrets",
      fixture,
    ]) {
      expect(html).not.toContain(privateValue);
    }
    // Check the metadata of a fresh document, not the prior route’s streaming transition.
    await page.goto(`/${language}/announcements/`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://loudweekend.eu/${language}/announcements/`,
    );
    await expect(page.locator('link[hreflang="de"]')).toHaveAttribute(
      "href",
      "https://loudweekend.eu/de/announcements/",
    );
    await main.getByRole("combobox", { name: country, exact: true }).selectOption("DE");
    await main.getByRole("button", { name: apply }).click();
    await expect(main.getByRole("link", { name: "Synthetic Alpine 2027" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Synthetic History Festival 2026" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await main.getByRole("combobox", { name: period, exact: true }).selectOption("30");
    await main.getByRole("button", { name: apply }).click();
    await expect(main.getByText(empty)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
}

test("changing the page language translates timeline filters and entries without losing the query", async ({
  page,
}) => {
  await page.goto("/en/announcements/?country=DE&period=90");
  const main = page.getByRole("main");
  const language = page.locator(".languagePicker select");
  await expect
    .poll(() =>
      language.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps")),
      ),
    )
    .toBe(true);
  await language.selectOption("de");
  await expect(main.getByRole("heading", { name: "Festivalmeldungen" })).toBeVisible();
  await expect(main.getByRole("combobox", { name: "Land", exact: true })).toHaveValue("DE");
  await expect(main.getByRole("combobox", { name: "Zeitraum", exact: true })).toHaveValue("90");
  await expect(main.getByText("Zeitplan aktualisiert")).toBeVisible();
  await page.reload();
  await expect(main.getByRole("heading", { name: "Festivalmeldungen" })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/announcements\/\?country=DE&period=90/);
});

test("announcement pagination is newest first and never joins the wrong edition", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const now = Date.now();
  const rows = Array.from({ length: 22 }, (_, index) => ({
    source: "ADMIN",
    sourceId: `${fixture}${suffix}:${index}`,
    actorLabel: "private fixture editor",
    festivalSlug: slug,
    editionYear: index === 21 ? 2025 : 2027,
    fields: ["lineup"],
    createdAt: new Date(now - index * 60_000),
  }));
  await db.catalogPublication.createMany({ data: rows });
  await page.goto("/en/announcements/?country=DE&period=30");
  const main = page.getByRole("main");
  await expect(main.locator("ol > li")).toHaveCount(20);
  await expect(main.locator("ol time").first()).toHaveAttribute(
    "datetime",
    new Date(now).toISOString(),
  );
  await main.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/country=DE&period=30&page=2/);
  await expect(main.locator("ol > li")).toHaveCount(1);
  await expect(main.locator("ol time").first()).toHaveAttribute(
    "datetime",
    new Date(now - 20 * 60_000).toISOString(),
  );
  await expect(main.getByRole("link", { name: "Synthetic History Festival 2025" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Previous page" })).toBeVisible();
});
