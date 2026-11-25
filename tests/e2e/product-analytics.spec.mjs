import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const endpoint = "/api/analytics/page-view/";
const mediaType = "application/vnd.loud-weekend.event+json";
const event = { event: "SEARCH_SUBMIT", locale: "en" };
const sameOrigin = { "content-type": mediaType, "sec-fetch-site": "same-origin" };

test("product counters are disabled unless explicitly enabled", async ({ request }) => {
  test.skip(process.env.PRODUCT_EVENTS_ENABLED === "true");
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  try {
    const before = await db.productEventDaily.count();
    expect((await request.post(endpoint, { headers: sameOrigin, data: event })).status()).toBe(204);
    expect(await db.productEventDaily.count()).toBe(before);
  } finally {
    await db.$disconnect();
  }
});

test("opt-in analytics send only aggregate data and honor DNT and GPC", async ({
  browser,
  request,
  baseURL,
}) => {
  test.skip(process.env.PRODUCT_EVENTS_ENABLED !== "true");
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const key = { day, ...event };
  const before = await db.productEventDaily.findUnique({ where: { day_event_locale: key } });
  try {
    const context = await browser.newContext();
    try {
      await context.addCookies([{ url: baseURL, name: "test-privacy-cookie", value: "synthetic" }]);
      const page = await context.newPage();
      await page.goto("/en/");
      const search = page.getByRole("textbox", { name: "Search festivals, artists or cities" });
      await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
      await search.fill("Synthetic private query");
      const [result] = await Promise.all([
        page.waitForResponse((res) => new URL(res.url()).pathname === endpoint),
        search.press("Enter"),
      ]);
      expect(result.status()).toBe(204);
      expect(result.request().postDataJSON()).toEqual(event);
      const headers = await result.request().allHeaders();
      expect(headers.cookie).toBeUndefined();
      expect(headers.referer).toBeUndefined();

      for (const [signal, property, value] of [
        ["DNT", "doNotTrack", "1"],
        ["GPC", "globalPrivacyControl", true],
      ]) {
        await page.evaluate(
          ({ property, value }) => {
            Object.defineProperty(navigator, property, { configurable: true, value });
          },
          { property, value },
        );
        let sent = false;
        const watch = (req) => {
          if (new URL(req.url()).pathname === endpoint) sent = true;
        };
        page.on("request", watch);
        await search.press("Enter");
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        page.off("request", watch);
        expect(sent, signal).toBe(false);
        await page.evaluate((property) => {
          delete navigator[property];
        }, property);
      }
    } finally {
      await context.close();
    }

    for (const headers of [{ dnt: "1" }, { "sec-gpc": "1" }]) {
      expect(
        (
          await request.post(endpoint, { headers: { ...sameOrigin, ...headers }, data: event })
        ).status(),
      ).toBe(204);
    }
    expect(
      (
        await request.post(endpoint, {
          headers: { ...sameOrigin, "sec-fetch-site": "cross-site" },
          data: event,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(endpoint, {
          headers: sameOrigin,
          data: { ...event, search: "synthetic" },
        })
      ).status(),
    ).toBe(400);
    const accepted = await Promise.all(
      Array.from({ length: 8 }, () => request.post(endpoint, { headers: sameOrigin, data: event })),
    );
    expect(accepted.map((response) => response.status())).toEqual(Array(8).fill(204));
    const row = await db.productEventDaily.findUniqueOrThrow({ where: { day_event_locale: key } });
    expect(row).toEqual({ ...key, count: (before?.count ?? 0) + 9 });
  } finally {
    if (before)
      await db.productEventDaily.update({
        where: { day_event_locale: key },
        data: { count: before.count },
      });
    else await db.productEventDaily.deleteMany({ where: key });
    await db.$disconnect();
  }
});
