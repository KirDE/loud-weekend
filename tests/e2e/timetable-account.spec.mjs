import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { importTimetable } from "../../lib/catalog/timetable-import.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("running order account copies are explicit, revisioned and isolated by account and edition", async ({
  browser,
  baseURL,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const device = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const second = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const other = await browser.newContext();
  const email = `running-order-${randomUUID()}@example.test`;
  const otherEmail = `other-${email}`;
  let editionId;
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
    const performance = {
      date: "2027-06-10",
      timeZone: "Europe/Paris",
      stage: "Main stage",
      start: "18:30",
      sourceUrl: new URL("/timetable/", edition.festival.officialUrl).href,
      observedAt: "2027-06-01T10:00:00Z",
      artist: "Account Fixture",
      status: "scheduled",
      sourcePerformanceId: "fixture:account-slot",
    };
    await importTimetable(
      db,
      { festivalSlug: "synthetic-west", editionYear: 2027, entries: [performance] },
      false,
    );
    editionId = edition.id;

    const url = "/api/running-order/synthetic-west/2027/";
    const options = { headers: { origin: baseURL } };
    const password = "synthetic-test-password";
    expect((await device.request.get(url)).status()).toBe(401);
    expect(
      (await device.request.post("/api/auth/register/", { data: { email, password } })).status(),
    ).toBe(201);
    expect(
      (await second.request.post("/api/auth/login/", { data: { email, password } })).ok(),
    ).toBe(true);
    expect(
      (
        await other.request.post("/api/auth/register/", { data: { email: otherEmail, password } })
      ).status(),
    ).toBe(201);

    const page = await device.newPage();
    await page.goto("/festivals/synthetic-west/2027/");
    const panel = page.locator(".runningOrderAccount");
    await page.getByRole("button", { name: "Save to running order: Account Fixture" }).click();
    expect(await db.runningOrder.count({ where: { editionId } })).toBe(0);
    await panel.getByText("Private account copy", { exact: true }).click();
    await panel.getByRole("button", { name: "Check account copy" }).click();
    await expect(panel.getByText("Saved performances: 0", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "Save device selection to account" }).click();
    await expect(panel.getByText("Account copy saved.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );

    const reply = await second.request.get(url);
    expect(reply.headers()["cache-control"]).toContain("private, no-store");
    const { account, copy } = await reply.json();
    expect(copy).toEqual({ revision: 1, performanceIds: [performance.sourcePerformanceId] });
    expect((await second.request.get("/api/running-order/synthetic-west/2099/")).status()).toBe(
      404,
    );
    expect((await (await other.request.get(url)).json()).copy).toEqual({
      revision: 0,
      performanceIds: [],
    });
    const ownerExport = await second.request.post("/api/auth/export/", options);
    expect(ownerExport.status()).toBe(200);
    expect(ownerExport.headers()["cache-control"]).toBe("private, no-store");
    expect((await ownerExport.json()).account.runningOrders).toEqual([
      {
        revision: copy.revision,
        performanceIds: copy.performanceIds,
        edition: { year: 2027, festival: { slug: "synthetic-west" } },
      },
    ]);
    const otherExport = await other.request.post("/api/auth/export/", options);
    expect(otherExport.status()).toBe(200);
    expect((await otherExport.json()).account.runningOrders).toEqual([]);
    const write = { accountId: account.id, revision: 1, performanceIds: copy.performanceIds };
    expect((await other.request.put(url, { ...options, data: write })).status()).toBe(409);
    expect((await second.request.put(url, { data: write })).status()).toBe(403);
    expect(
      (
        await second.request.put(url, {
          ...options,
          data: { ...write, performanceIds: ["unknown-set"] },
        })
      ).status(),
    ).toBe(400);

    const remote = await second.newPage();
    await remote.goto("/festivals/synthetic-west/2027/");
    const toggle = remote.getByRole("button", { name: /running order: Account Fixture/ });
    const remotePanel = remote.locator(".runningOrderAccount");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await remotePanel.getByText("Private account copy", { exact: true }).click();
    await remotePanel.getByRole("button", { name: "Check account copy" }).click();
    await expect(remotePanel.getByText("Saved performances: 1", { exact: false })).toBeVisible();
    await remotePanel
      .getByRole("button", { name: "Replace device selection with account copy" })
      .click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const sameDeviceTab = await second.newPage();
    await sameDeviceTab.goto("/festivals/synthetic-west/2027/");
    const replace = remotePanel.getByRole("button", {
      name: "Replace device selection with account copy",
    });
    const readStarted = Promise.withResolvers();
    const releaseRead = Promise.withResolvers();
    const pattern = "**/api/running-order/synthetic-west/2027/";
    await remote.route(pattern, async (route) => {
      const response = await route.fetch();
      readStarted.resolve();
      await releaseRead.promise;
      await route.fulfill({ response });
    });
    try {
      await replace.click();
      await readStarted.promise;
      await sameDeviceTab.getByRole("button", { name: /running order: Account Fixture/ }).click();
    } finally {
      releaseRead.resolve();
    }
    await expect(remotePanel.getByText(/Your device selection changed/)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await remote.unroute(pattern);
    await replace.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const simultaneous = await Promise.all([
      second.request.put(url, { ...options, data: write }),
      device.request.put(url, { ...options, data: write }),
    ]);
    expect(simultaneous.map((response) => response.status()).sort()).toEqual([200, 409]);
    await panel.getByRole("button", { name: "Clear account copy" }).click();
    await expect(panel.getByText(/no selection was replaced/)).toBeVisible();
    await panel.getByRole("button", { name: "Check account copy" }).click();
    await panel.getByRole("button", { name: "Clear account copy" }).click();
    await expect(panel.getByText("Account copy cleared.", { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect((await (await second.request.get(url)).json()).copy).toEqual({
      revision: 3,
      performanceIds: [],
    });
  } finally {
    await Promise.all([device.close(), second.close(), other.close()]);
    await db.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    if (editionId) await db.timetablePerformance.deleteMany({ where: { editionId } });
    await db.$disconnect();
  }
});
