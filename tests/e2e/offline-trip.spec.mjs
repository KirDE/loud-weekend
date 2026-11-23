import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { importTimetable } from "../../lib/catalog/timetable-import.ts";

test("explicit mobile trip download keeps only public proof and works offline", async ({ page, context, request }) => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname) || !/(?:test|integration)/i.test(databaseUrl.pathname)) {
    throw new Error("A loopback disposable DATABASE_URL is required");
  }
  const db = createPrismaClient();
  const where = { festival: { slug: "synthetic-fest" }, year: 2027 };
  const target = await db.festivalEdition.findFirstOrThrow({ where, select: { id: true } });
  const entry = {
    date: "2027-06-11", start: "20:30", stage: "Fixture Stage", artist: "Sample Artist",
    timeZone: "Europe/Berlin", status: "scheduled", sourceUrl: "https://festival.example.test/timetable",
    observedAt: "2027-01-01T10:00:00.000Z",
  };
  const api = "/api/offline/trips/synthetic-fest/2027/";
  try {
    await importTimetable(db, { festivalSlug: "synthetic-fest", editionYear: 2027, entries: [entry] }, false);

    await db.timetablePerformance.createMany({ data: [
      { editionId: target.id, date: new Date(entry.date), start: "20:31", stage: entry.stage, artistName: "Invalid zone",
        timeZone: "City/Unknown", sourceUrl: entry.sourceUrl, observedAt: new Date(entry.observedAt) },
      { editionId: target.id, date: new Date(entry.date), start: "20:32", stage: entry.stage, artistName: "Invalid source",
        timeZone: entry.timeZone, sourceUrl: "unverified", observedAt: new Date(entry.observedAt) },
    ] });
    const download = await request.get(api);
    expect(download.status()).toBe(200);
    expect(download.headers()["cache-control"]).toBe("no-store");
    const body = await download.json();
    expect(body).toMatchObject({
      slug: "synthetic-fest", year: 2027, location: expect.stringContaining("Testland"),
      timetable: [{ stage: "Fixture Stage", status: "scheduled", checkedAt: entry.observedAt }],
    });
    expect(JSON.stringify(body)).not.toContain("festival.example.test");
    expect(JSON.stringify(body)).not.toContain(target.id);
    expect((await request.get(api.replace("2027", "2099"))).status()).toBe(404);

    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/de/festivals/synthetic-fest/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.getByRole("heading", { name: "Offline-Reisedetails" })).toBeVisible();
    const saved = () => page.evaluate(() => localStorage.getItem("festival-radar-offline-trip:v1:synthetic-fest:2027"));
    expect(await saved()).toBeNull();
    const language = page.getByLabel("Sprache", { exact: true });
    await language.selectOption("en");
    await expect(page.getByRole("button", { name: "Save trip offline" })).toBeVisible();
    await page.getByLabel("Language", { exact: true }).selectOption("ru");
    await expect(page.getByRole("button", { name: "Сохранить поездку офлайн" })).toBeVisible();
    await page.getByLabel("Язык", { exact: true }).selectOption("de");
    await page.getByRole("button", { name: "Reise offline speichern" }).click();
    await expect(page.getByText("Reisedetails wurden auf diesem Gerät gespeichert.")).toBeVisible();
    expect(JSON.parse(await saved()).trip.timetable[0].status).toBe("scheduled");

    await importTimetable(db, {
      festivalSlug: "synthetic-fest", editionYear: 2027,
      entries: [{ ...entry, status: "cancelled", observedAt: "2027-01-02T10:00:00.000Z" }],
    }, false);
    await page.getByRole("link", { name: "Offline-Reisen öffnen" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { name: "Offline-Reisen", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Festivalliste öffnen" })).toHaveAttribute("href", "/de/");
    const trip = page.locator("#trips article");
    const update = trip.getByRole("button", { name: "Offline-Kopie aktualisieren: Synthetic Fest" });
    await expect(trip.getByText("Abgesagt", { exact: false })).toHaveCount(0);
    const sent = page.waitForRequest((req) => new URL(req.url()).pathname === api);
    await update.click();
    expect(await (await sent).headerValue("cookie")).toBeNull();
    await expect(trip.getByRole("status")).toHaveText("Reisedetails wurden auf diesem Gerät gespeichert.");
    await expect(update).toBeFocused();
    await expect(trip.getByText("Abgesagt", { exact: false })).toContainText("20:30");
    await expect.poll(async () => JSON.parse(await saved()).trip.timetable[0].status).toBe("cancelled");

    const lastGood = await saved();
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("festival-radar-offline-trip:")) throw new DOMException("Full", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
    await update.click();
    await expect(page.getByText("Offline-Kopie konnte nicht geändert werden.", { exact: false })).toBeVisible();
    expect(await saved()).toBe(lastGood);

    const cachedPaths = await page.evaluate(async () => {
      const all = await Promise.all((await caches.keys()).map(async (key) => (await caches.open(key)).keys()));
      return all.flat().map((key) => new URL(key.url).pathname);
    });
    expect(cachedPaths).not.toContain(api);
    expect(cachedPaths.every((p) => !p.startsWith("/api/auth/") && !p.startsWith("/api/sync/"))).toBe(true);

    await context.setOffline(true);
    await page.goto("/ru/festivals/synthetic-fest/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { name: "Поездки офлайн", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть список фестивалей" })).toHaveAttribute("href", "/ru/");
    await page.goto("/de/festivals/synthetic-fest/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(trip.getByRole("heading", { name: "Synthetic Fest 2027" })).toBeVisible();
    await expect(trip.getByText("Abgesagt", { exact: false })).toContainText("20:30");
    await expect(trip.getByText(/Festivalort: .*Testland/)).toBeVisible();
    await expect(page.getByText("Offline-Kopie. Termine", { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await update.click();
    await expect(trip.getByRole("status")).toContainText("Reisedetails nicht verfügbar");
    expect(await saved()).toBe(lastGood);
    await trip.getByRole("button", { name: "Offline-Kopie entfernen: Synthetic Fest" }).click();
    await expect(page.getByText("Auf diesem Gerät wurden keine Reisedetails gespeichert.")).toBeVisible();
    expect(await saved()).toBeNull();
  } finally {
    await db.timetablePerformance.deleteMany({ where: { editionId: target.id, stage: entry.stage } });
    await db.$disconnect();
  }
});

test("refreshing an offline trip does not restore a copy removed in another tab", async ({ page, context }) => {
  const festivalPath = "/en/festivals/synthetic-fest/";
  const key = "festival-radar-offline-trip:v1:synthetic-fest:2027";
  await page.goto(festivalPath);
  const save = page.getByRole("button", { name: "Save trip offline", exact: true });
  await save.click();
  const refresh = page.getByRole("button", { name: "Update offline copy", exact: true });
  await expect(refresh).toBeVisible();

  const otherTab = await context.newPage();
  const responseReady = Promise.withResolvers();
  const releaseResponse = Promise.withResolvers();
  await page.route("**/api/offline/trips/synthetic-fest/2027/", async route => {
    const response = await route.fetch();
    responseReady.resolve(response.status());
    await releaseResponse.promise;
    await route.fulfill({ response });
  });
  try {
    await refresh.click();
    expect(await responseReady.promise).toBe(200);
    await otherTab.goto("/offline.html#trips");
    await otherTab.getByRole("button", { name: "Remove offline copy: Synthetic Fest" }).click();
    releaseResponse.resolve();

    await expect(save).toBeEnabled();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  } finally {
    releaseResponse.resolve();
    await otherTab.close();
  }
});
