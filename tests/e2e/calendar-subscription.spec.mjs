import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const subscription = "/api/calendar/subscription/";
const feed = "/api/calendar/feed/";
const credentials = () => ({
  email: `fixture-calendar-${randomUUID()}@example.test`,
  password: "fixture-disposable-password",
});

for (const [language, labels] of Object.entries({
  en: [
    "Create calendar link",
    "Replace calendar link",
    "Revoke calendar link",
    "Calendar subscription URL",
  ],
  de: [
    "Kalenderlink erstellen",
    "Kalenderlink ersetzen",
    "Kalenderlink widerrufen",
    "Adresse des Kalenderabos",
  ],
  ru: [
    "Создать ссылку на календарь",
    "Заменить ссылку на календарь",
    "Отозвать ссылку на календарь",
    "Адрес подписки на календарь",
  ],
})) {
  test(`${language} planner manages a private calendar URL at 320px`, async ({
    page,
    context,
    request,
  }) => {
    requireLocalDisposableDatabase(process.env.DATABASE_URL);
    const auth = credentials();
    const db = createPrismaClient();
    try {
      const registered = await context.request.post("/api/auth/register/", { data: auth });
      expect(registered.status()).toBe(201);
      await page.setViewportSize({ width: 320, height: 760 });
      const url = page.getByRole("textbox", { name: labels[3] });
      await page.goto(`/${language}/planner/`);
      await page.getByRole("button", { name: labels[0], exact: true }).click();
      await expect(url).toBeVisible();
      const first = await url.inputValue();
      expect(new URL(first).pathname).toBe(feed);
      expect((await request.get(first)).status()).toBe(200);
      await page.reload();
      await expect(url).toHaveCount(0);
      await page.getByRole("button", { name: labels[1], exact: true }).click();
      await expect(url).toBeVisible();
      const next = await url.inputValue();
      expect(new URL(next).searchParams.get("key") !== new URL(first).searchParams.get("key")).toBe(
        true,
      );
      expect((await request.get(first)).status()).toBe(404);
      expect((await request.get(next)).status()).toBe(200);
      await page.getByRole("button", { name: labels[2], exact: true }).click();
      await expect(page.getByRole("button", { name: labels[0], exact: true })).toBeVisible();
      expect((await request.get(next)).status()).toBe(404);
      expect(
        await page.locator("html").evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(320);
    } finally {
      await db.user.deleteMany({ where: { email: auth.email } });
      await db.$disconnect();
    }
  });
}

test("feed follows synced plans and published dates but never another account", async ({
  context,
  request,
  baseURL,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const auth = credentials();
  const db = createPrismaClient();
  const headers = { Origin: baseURL };
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { year: 2027, festival: { slug: "synthetic-fest" } },
  });
  const otherEdition = await db.festivalEdition.create({
    data: {
      festivalId: edition.festivalId,
      year: 2028,
      recordState: "CURRENT",
      status: "CONFIRMED",
      ticketStatus: "UNKNOWN",
      completeness: "PARTIAL",
      sourceUpdatedAt: new Date(),
      startDate: new Date("2028-07-20T00:00:00Z"),
      endDate: new Date("2028-07-22T00:00:00Z"),
    },
  });
  try {
    expect((await request.get(subscription)).status()).toBe(401);
    expect((await request.post(subscription, { headers })).status()).toBe(401);
    const registered = await context.request.post("/api/auth/register/", { data: auth });
    expect(registered.status()).toBe(201);
    const { user } = await registered.json();
    expect(
      (
        await context.request.post(subscription, {
          headers: { Origin: "https://other.example.test" },
        })
      ).status(),
    ).toBe(403);
    const putPlan = (attendance, revision) =>
      context.request.put("/api/sync/plans/", {
        data: { payload: { attendance, privateNote: "fixture-never-in-feed" }, revision },
        headers,
      });
    expect(
      (await putPlan({ "synthetic-fest": "going", "synthetic-alpine": "not-going" }, 0)).status(),
    ).toBe(201);
    const made = await context.request.post(subscription, { headers });
    expect(made.status()).toBe(201);
    expect(made.headers()["cache-control"]).toBe("private, no-store");
    const { key } = await made.json();
    const readStatus = await context.request.get(subscription);
    expect(await readStatus.json()).toEqual({ active: true, available: true });
    const stored = await db.calendarSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.keyDigest !== key && stored.keyDigest.length === 64).toBe(true);
    expect(stored.seasons).toEqual([2027]);
    // An older subscription may have stored several current years.
    await db.calendarSubscription.update({
      where: { userId: user.id },
      data: { seasons: [2027, 2028] },
    });
    const url = `${feed}?key=${key}`;
    const first = await request.get(url);
    expect(first.status()).toBe(200);
    expect(first.headers()["x-robots-tag"]).toContain("noindex");
    expect(first.headers()["cache-control"]).toBe("private, no-store");
    expect(first.headers()["content-type"]).toContain("text/calendar");
    const ics = await first.text();
    expect(ics).toContain("SUMMARY:Synthetic Fest");
    expect(ics).not.toContain("DTSTART;VALUE=DATE:20280720");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("SUMMARY:Synthetic Alpine");
    expect(ics).not.toContain("fixture-never-in-feed");
    expect(ics.includes(auth.email) || ics.includes(key)).toBe(false);
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    const uid = ics.match(/^UID:.+$/m)?.[0];
    expect(uid).toBeTruthy();
    expect(await (await request.get(url)).text()).toBe(ics);

    await db.festivalEdition.update({
      where: { id: edition.id },
      data: {
        startDate: new Date("2027-10-30T00:00:00Z"),
        endDate: new Date("2027-10-31T00:00:00Z"),
      },
    });
    const shifted = await (await request.get(url)).text();
    expect(shifted).toContain(uid);
    expect(shifted).toContain("DTSTART;VALUE=DATE:20271030");
    expect(shifted).toContain("DTEND;VALUE=DATE:20271101");
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: {
        endDate: new Date("2027-10-29T00:00:00Z"),
      },
    });
    const invalidRange = await request.get(url);
    expect(invalidRange.status()).toBe(200);
    expect(await invalidRange.text()).not.toContain("VEVENT");

    expect((await putPlan({ "synthetic-fest": "not-going" }, 1)).status()).toBe(200);
    expect(await (await request.get(url)).text()).not.toContain("VEVENT");
    await db.user.delete({ where: { id: user.id } });
    expect((await request.get(url)).status()).toBe(404);
  } finally {
    await db.user.deleteMany({ where: { email: auth.email } });
    await db.festivalEdition.update({
      where: { id: edition.id },
      data: {
        startDate: edition.startDate,
        endDate: edition.endDate,
      },
    });
    await db.festivalEdition.delete({ where: { id: otherEdition.id } });
    await db.$disconnect();
  }
});
