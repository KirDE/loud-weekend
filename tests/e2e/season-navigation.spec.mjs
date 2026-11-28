import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const copy = {
  en: {
    nav: "Festival seasons",
    heading: "2028 festival editions",
    noArtists: "No current acts listed",
    editionCalendar: "Download edition calendar (.ics)",
  },
  de: {
    nav: "Festivalsaisons",
    heading: "Festivalausgaben 2028",
    noArtists: "Derzeit keine Acts gelistet",
    editionCalendar: "Ausgabekalender herunterladen (.ics)",
  },
  ru: {
    nav: "Фестивальные сезоны",
    heading: "Выпуски фестивалей 2028 года",
    noArtists: "Нет действующих анонсов",
    editionCalendar: "Скачать календарь выпуска (.ics)",
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
            year === 2028 || archived
              ? {
                  create: (archived ? ["startDate", "endDate"] : ["edition", "startDate"]).map(
                    (field) => ({
                      field,
                      url: `https://festival.example.test/${year}`,
                      note: "Synthetic reviewed edition evidence",
                      checkedAt: new Date(),
                    }),
                  ),
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
        await page.goto(lang === "en" ? "/planner/" : `/${lang}/planner/`);
        await expect(nav.getByRole("link")).toHaveText(["2028", "2027", "2026"]);
        await nav.getByRole("link", { name: "2028", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${lang}/editions/2028/$`));
        await expect(page.getByRole("heading", { level: 1, name: t.heading })).toBeVisible();
        await expect(nav.getByRole("link", { name: "2028" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expect(
          page.getByRole("article").filter({ hasText: "Synthetic Fest 2028" }),
        ).toContainText(t.noArtists);
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
        await page.goto(`/festivals/synthetic-fest/2026/`);
        const editionCalendar = page.getByRole("link", { name: t.editionCalendar });
        const [editionDownload] = await Promise.all([
          page.waitForEvent("download"),
          editionCalendar.click({ timeout: 10_000 }),
        ]);
        expect(editionDownload.suggestedFilename()).toBe("synthetic-fest-2026.ics");
        const editionHref = await editionCalendar.getAttribute("href");
        const editionIcs = decodeURIComponent(editionHref.split(",")[1]);
        expect(editionIcs).toContain("UID:synthetic-fest-2026@festival-radar");
        expect(editionIcs).toContain("DTSTART;VALUE=DATE:20260703");
        expect(editionIcs).not.toContain("20270703");
        await page.goto(`/festivals/synthetic-fest/2028/`);
        await expect(
          page.getByRole("heading", { name: "Synthetic Fest 2028", exact: true }),
        ).toBeVisible();
        await expect(editionCalendar).toHaveCount(0);
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

test("account sync restores only verified season attendance and never shares it publicly", async ({
  browser,
  baseURL,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const first = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const second = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const email = `season-attendance-${Date.now()}@example.test`;
  const password = "synthetic-season-password";
  let editionId;
  try {
    const festival = await db.festival.findUniqueOrThrow({
      where: { slug: "synthetic-fest" },
      select: { id: true, officialUrl: true },
    });
    const edition = await db.festivalEdition.create({
      data: {
        festivalId: festival.id,
        year: 2028,
        status: "TBA",
        ticketStatus: "UNKNOWN",
        recordState: "TRACKING",
        completeness: "TBA",
        sourceUpdatedAt: new Date(),
        provenance: {
          create: {
            field: "edition",
            url: festival.officialUrl,
            note: "Synthetic reviewed announcement",
            checkedAt: new Date(),
          },
        },
      },
    });
    editionId = edition.id;
    expect(
      (await first.request.post("/api/auth/register/", { data: { email, password } })).status(),
    ).toBe(201);
    expect(
      (await second.request.post("/api/auth/login/", { data: { email, password } })).ok(),
    ).toBe(true);

    const key = "2028:synthetic-fest";
    const plan = await first.newPage();
    await plan.goto("/en/editions/2028/");
    await plan.getByRole("combobox", { name: /Synthetic Fest 2028$/ }).selectOption("maybe");
    await plan.goto("/en/planner/");
    const sync = plan.locator(".accountSync");
    const endpoint = "/api/sync/season-attendance/";
    expect((await (await first.request.get(endpoint)).json()).document).toBeNull();
    await sync.getByRole("button", { name: "Merge this device into my account" }).click();
    await expect(sync.getByText("Everything is synchronized.", { exact: true })).toBeVisible();

    const response = await second.request.get(endpoint);
    expect(response.headers()["cache-control"]).toContain("private, no-store");
    const { document } = await response.json();
    expect(document.payload).toEqual({ seasonAttendance: { [key]: "maybe" } });
    const authenticated = await second.request.get("/api/auth/me/");
    const { user } = await authenticated.json();
    const put = (seasonAttendance, accountId = user.id) =>
      second.request.put(endpoint, {
        headers: { origin: baseURL },
        data: { accountId, revision: document.revision, payload: { seasonAttendance } },
      });
    expect((await put({ "2099:synthetic-fest": "going" })).status()).toBe(400);
    expect((await put({ "2027:synthetic-fest": "going" })).status()).toBe(400);
    expect((await put({ [key]: "going" }, "different-account")).status()).toBe(409);
    expect((await (await second.request.get("/api/sync/plans/")).json()).document.payload).toEqual({
      attendance: {},
    });

    const share = await first.request.post("/api/share/", {
      headers: { origin: baseURL },
      data: { documentId: document.id },
    });
    expect(share.status()).toBe(404);
    const corruptShare = await db.shareLink.create({
      data: { slug: `synthetic-${edition.id}`, userId: user.id, documentId: document.id },
    });
    for (const route of ["/api/share/", "/share/"]) {
      expect((await first.request.get(`${route}${corruptShare.slug}/`)).status()).toBe(404);
    }

    const restored = await second.newPage();
    await restored.goto("/en/planner/");
    await restored.getByRole("button", { name: "Use account data on this device" }).click();
    await expect(restored.getByText("Everything is synchronized.", { exact: true })).toBeVisible();
    await restored.goto("/en/editions/2028/");
    const attendance = restored.getByRole("combobox", { name: /Synthetic Fest 2028$/ });
    await expect(attendance).toHaveValue("maybe");
    await attendance.selectOption("");
    await restored.goto("/en/planner/");
    await restored.getByRole("button", { name: "Sync now" }).click();
    await expect(restored.getByText("Everything is synchronized.", { exact: true })).toBeVisible();
    const cleared = await (await second.request.get(endpoint)).json();
    expect(cleared.document.payload).toEqual({ seasonAttendance: {} });
    await plan.reload();
    await sync.getByRole("button", { name: "Use account data on this device" }).click();
    await expect(sync.getByText("Everything is synchronized.", { exact: true })).toBeVisible();
    await plan.goto("/en/editions/2028/");
    await expect(plan.getByRole("combobox", { name: /Synthetic Fest 2028$/ })).toHaveValue("");
    await plan.getByRole("combobox", { name: /Synthetic Fest 2028$/ }).selectOption("going");
    await plan.goto("/en/planner/");
    await expect(sync.getByRole("button", { name: "Sync now" })).toBeVisible();
    const favorite = (await (await second.request.get("/api/sync/favorites/")).json()).document;
    expect(
      (
        await second.request.put("/api/sync/favorites/", {
          headers: { origin: baseURL },
          data: { revision: favorite.revision, payload: { favoriteFestivals: ["synthetic-fest"] } },
        })
      ).ok(),
    ).toBe(true);
    await sync.getByRole("button", { name: "Sync now" }).click();
    await expect(sync.getByRole("alert")).toContainText("A newer version exists");
    await sync.getByRole("button", { name: "Use other device" }).click();
    await plan.goto("/en/editions/2028/");
    await expect(plan.getByRole("combobox", { name: /Synthetic Fest 2028$/ })).toHaveValue("going");
    expect((await (await second.request.get(endpoint)).json()).document.payload).toEqual({
      seasonAttendance: {},
    });
  } finally {
    await Promise.all([first.close(), second.close()]);
    await db.user.deleteMany({ where: { email } });
    if (editionId) await db.festivalEdition.deleteMany({ where: { id: editionId } });
    await db.$disconnect();
  }
});
