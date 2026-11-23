import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const copy = {
  en: { nav: "Festival seasons", heading: "2028 festival editions", tba: "Lineup TBA" },
  de: { nav: "Festivalsaisons", heading: "Festivalausgaben 2028", tba: "Line-up offen" },
  ru: {
    nav: "Фестивальные сезоны",
    heading: "Выпуски фестивалей 2028 года",
    tba: "Лайнап уточняется",
  },
};

test("season navigation and local attendance use verified editions without replacing the 2027 plan", async ({
  browser,
  request,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    const current = await db.festival.findUniqueOrThrow({ where: { slug: "synthetic-fest" } });
    for (const year of [2026, 2028, 2029]) {
      const archived = year === 2026;
      const edition = await db.festivalEdition.create({
        data: {
          festivalId: current.id,
          year,
          status: "TBA",
          ticketStatus: "UNKNOWN",
          startDate: new Date(`${year}-07-03T00:00:00.000Z`),
          endDate: new Date(`${year}-07-05T00:00:00.000Z`),
          recordState: archived ? "ARCHIVED" : "TRACKING",
          completeness: "TBA",
          sourceUpdatedAt: new Date(),
          snapshotAt: archived ? new Date("2026-11-01") : null,
          provenance:
            year === 2028
              ? {
                  create: {
                    field: "edition",
                    url: "https://festival.example.test/2028",
                    note: "Synthetic edition announcement",
                    checkedAt: new Date(),
                  },
                }
              : archived
                ? {
                    create: {
                      field: "dates",
                      url: "https://festival.example.test/2026",
                      note: "Synthetic archived date evidence",
                      checkedAt: new Date(),
                    },
                  }
                : undefined,
        },
        select: { id: true },
      });
      inserted.push(edition.id);
    }

    for (const [lang, t] of Object.entries(copy)) {
      const context = await browser.newContext({
        viewport: { width: lang === "de" ? 390 : 320, height: 720 },
      });
      try {
        const page = await context.newPage();
        const planKey = "festival-radar-planner-v1";
        await page.addInitScript(
          ({ planKey }) => {
            if (!localStorage.getItem(planKey)) {
              localStorage.setItem(
                planKey,
                JSON.stringify({
                  favoriteFestivals: ["synthetic-fest"],
                  attendance: { "synthetic-fest": "going" },
                }),
              );
            }
          },
          { planKey },
        );
        await page.goto(`/${lang}/`);
        const readPlan = () =>
          page.evaluate((key) => JSON.parse(localStorage.getItem(key)), planKey);
        const remoteMutations = [];
        page.on("request", (event) => {
          if (
            new URL(event.url()).pathname.startsWith("/api/") &&
            !["GET", "HEAD", "OPTIONS"].includes(event.method())
          )
            remoteMutations.push(event.url());
        });
        const select = (year) =>
          page.getByRole("combobox", { name: new RegExp(`Synthetic Fest ${year}$`) });
        const calendar = page.locator("a[download$='-plan.ics']");
        const nav = page.getByRole("navigation", { name: t.nav });
        await expect(nav.getByRole("link")).toHaveText(["2028", "2027", "2026"]);
        await nav.getByRole("link", { name: "2028", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${lang}/editions/2028/$`));
        await expect(page.getByRole("heading", { level: 1, name: t.heading })).toBeVisible();
        await expect(nav.getByRole("link", { name: "2028" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expect(page.getByText(t.tba, { exact: false })).toBeVisible();
        await expect(page.getByText("Synthetic Alpine 2028")).toHaveCount(0);
        await expect(select(2028)).toHaveValue("");
        await select(2028).selectOption("maybe");
        await expect(calendar).toHaveCount(0);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await nav.getByRole("link", { name: "2026" }).click();
        await expect(page.getByText("Synthetic Fest 2026", { exact: true })).toBeVisible();
        await expect(select(2026)).toHaveValue("");
        await select(2026).selectOption("going");
        await expect(calendar).toHaveAttribute("download", "loud-weekend-2026-plan.ics");
        const [download] = await Promise.all([page.waitForEvent("download"), calendar.click()]);
        expect(download.suggestedFilename()).toBe("loud-weekend-2026-plan.ics");
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const ics = Buffer.concat(chunks).toString("utf8");
        expect(ics).toContain("UID:synthetic-fest-2026@festival-radar");
        expect(ics).toContain("DTSTART;VALUE=DATE:20260703");
        expect(ics).toContain("DTEND;VALUE=DATE:20260706");
        expect(ics).not.toContain("synthetic-fest-2028");
        await select(2026).selectOption("not-going");
        await expect(calendar).toHaveCount(0);
        await page.reload();
        await expect(select(2026)).toHaveValue("not-going");
        await nav.getByRole("link", { name: "2027" }).click();
        await expect(page.getByText("Synthetic Alpine 2027")).toBeVisible();
        await expect(select(2027)).toHaveValue("going");
        expect((await readPlan()).seasonAttendance).toEqual({
          "2026:synthetic-fest": "not-going",
          "2028:synthetic-fest": "maybe",
        });
        expect(remoteMutations).toEqual([]);
        expect((await readPlan()).attendance).toEqual({ "synthetic-fest": "going" });
        expect((await readPlan()).favoriteFestivals).toEqual(["synthetic-fest"]);
        if (lang === "en") {
          await page.goto("/en/planner/");
          await page.getByRole("button", { name: "Clear local data" }).click();
          await page.getByRole("button", { name: "Reset local plan" }).click();
          await expect.poll(async () => (await readPlan()).seasonAttendance).toBeUndefined();
          await page.getByRole("button", { name: "Undo local reset" }).click();
          await expect
            .poll(async () => (await readPlan()).seasonAttendance)
            .toEqual({
              "2026:synthetic-fest": "not-going",
              "2028:synthetic-fest": "maybe",
            });
        }
      } finally {
        await context.close();
      }

      const response = await request.get(`/${lang}/editions/2028/`, {
        headers: { "user-agent": "Twitterbot/1.0" },
      });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(
        `rel="canonical" href="https://loudweekend.eu/${lang}/editions/2028/"`,
      );
      expect(html).toContain('hrefLang="x-default" href="https://loudweekend.eu/editions/2028/"');
    }

    for (const path of [
      "/editions/2029/",
      "/editions/02027/",
      "/editions/2e3/",
      "/de/editions/future/",
      "/fr/editions/2027/",
    ]) {
      expect(
        (await request.get(path, { headers: { "user-agent": "Twitterbot/1.0" } })).status(),
        path,
      ).toBe(404);
    }
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const xml = await sitemap.text();
    expect(xml).toContain("https://loudweekend.eu/ru/editions/2028/");
    expect(xml).not.toContain("/editions/2029/");
  } finally {
    if (inserted.length) await db.festivalEdition.deleteMany({ where: { id: { in: inserted } } });
    await db.$disconnect();
  }
});
