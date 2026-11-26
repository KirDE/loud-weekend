import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";
import { stageEditionLifecycle } from "../../lib/ingestion/edition-lifecycle-proposal-store.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
let festivalId, editionId, snapshot, actorId, staleArtistId;
const html = readFileSync(
  new URL("../fixtures/rock-en-seine/hiatus.html", import.meta.url),
  "utf8",
);
const url = "https://www.rockenseine.com/";
test.beforeAll(async () => {
  expect(await db.festival.count({ where: { slug: "rock-en-seine" } })).toBe(0);
  const f = await db.festival.create({
    data: {
      slug: "rock-en-seine",
      name: "Rock en Seine",
      country: "France",
      countryCode: "FR",
      officialUrl: url,
      genres: [],
    },
  });
  festivalId = f.id;
  editionId = (
    await db.festivalEdition.create({
      data: {
        festivalId,
        year: 2027,
        recordState: "CURRENT",
        status: "CONFIRMED",
        ticketStatus: "AVAILABLE",
        ticketsUrl: "https://tickets.example.invalid/old",
        completeness: "COMPLETE",
        sourceUpdatedAt: new Date(),
        startDate: new Date("2027-08-25"),
        endDate: new Date("2027-08-29"),
      },
    })
  ).id;
  staleArtistId = (
    await db.artist.create({
      data: {
        slug: "paused-browser-roster",
        name: "Paused Browser Artist",
        identityState: "UNRESOLVED",
        aliases: [],
        genres: [],
        topTracks: [],
        recentSetlists: [],
        freshness: {},
      },
    })
  ).id;
  await db.lineupEntry.create({
    data: { editionId, artistId: staleArtistId, billing: "HEADLINER", position: 0 },
  });
  snapshot = await stageEditionLifecycle(db, {
    parserVersion: "rock-en-seine-hiatus-v1",
    editionId,
    html,
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    observedAt: new Date().toISOString(),
  });
  const actor = await db.user.upsert({
    where: { email: "browser-admin@example.test" },
    create: {
      email: "browser-admin@example.test",
      passwordHash: "not-a-login-hash",
      role: "ADMIN",
    },
    update: { role: "ADMIN" },
  });
  actorId = actor.id;
});
test.afterAll(async () => {
  if (editionId)
    await db.editionLifecycleReviewDecision.deleteMany({ where: { snapshot: { editionId } } });
  if (festivalId) await db.festival.delete({ where: { id: festivalId } });
  if (staleArtistId) await db.artist.delete({ where: { id: staleArtistId } });
  await db.$disconnect();
});
test("actual reviewer approval→catalogue EN/DE/RU desktop and mobile, offline and SEO", async ({
  page,
  context,
}) => {
  // Pending never publishes a hiatus.
  await page.goto("/en/festivals/rock-en-seine/");
  await expect(
    page.locator("section.sourceNote").filter({ has: page.locator("time") }),
  ).toHaveCount(0);
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId: actorId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000 * 30),
    },
  });
  await context.addCookies([
    {
      name: "festival_radar_session",
      value: token,
      url: "http://localhost:3245",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin/?section=review");
  const card = page.locator("article.reviewCard").filter({ hasText: "rock-en-seine · 2027" });
  await card.getByRole("button", { name: "Load latest proposal" }).click();
  await expect(card).toContainText("Pending review");
  await card.getByRole("button", { name: "Approve announcement" }).click();
  await expect(card).toContainText("Approved — catalogue notice");
  expect(
    (await db.editionLifecycleReviewDecision.findUnique({ where: { snapshotId: snapshot.id } }))
      .actorId,
  ).toBe(actorId);
  await context.clearCookies();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ["en", "de", "ru"]) {
      await page.goto(`/${locale}/festivals/rock-en-seine/`);
      const notice = page.locator("section.sourceNote").filter({ has: page.locator("time") });
      await expect(notice).toContainText("2028");
      await expect(notice.locator("time")).toHaveAttribute(
        "datetime",
        snapshot.observedAt.toISOString(),
      );
      await expect(notice.locator("a")).toHaveAttribute("href", url);
      expect(await page.locator('a[href="https://tickets.example.invalid/old"]').count()).toBe(0);
      expect(
        await page.locator('script[type="application/ld+json"]').allTextContents(),
      ).not.toEqual(expect.arrayContaining([expect.stringContaining("MusicEvent")]));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      ).toBe(true);
    }
  }
  // Retained saved selection must not export or submit the paused roster.
  await page.addInitScript(() =>
    localStorage.setItem(
      "festival-radar-planner-v1",
      JSON.stringify({
        favoriteFestivals: [],
        favoriteArtists: [],
        attendance: { "rock-en-seine": "going" },
        playlistFestivals: ["rock-en-seine", "synthetic-fest"],
      }),
    ),
  );
  let submitted;
  await page.route("**/api/spotify/selection-playlist", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: { playlistUrl: "https://example.invalid/synthetic-playlist", trackCount: 1 },
    });
  });
  await page.goto("/en/planner/");
  const exportList = page.locator('a[download="loud-weekend-playlist-artists.txt"]');
  await expect(exportList).toHaveCount(1);
  expect(decodeURIComponent(await exportList.getAttribute("href"))).not.toContain(
    "Paused Browser Artist",
  );
  await page.getByRole("button", { name: "Create private Spotify playlist", exact: true }).click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted.artists).not.toContain("Paused Browser Artist");
  expect(submitted.artists).toContain("Sample Artist");
  expect(submitted.festivals).not.toContain("Rock en Seine");
  const attendance = page.locator(".planList select");
  await expect(attendance).toHaveValue("going");
  await expect(attendance).toBeEnabled();
  await expect(attendance.locator('option[value="going"]')).toBeDisabled();
  await attendance.selectOption("");
  await expect(page.locator(".planList article")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("festival-radar-planner-v1")).attendance["rock-en-seine"],
      ),
    )
    .toBeUndefined();
  await page.goto("/en/festivals/rock-en-seine/");
  const detailAttendance = page.locator(".localActions select");
  await expect(detailAttendance).toHaveValue("going");
  await expect(detailAttendance).toBeEnabled();
  await detailAttendance.selectOption("");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("festival-radar-planner-v1")).attendance["rock-en-seine"],
      ),
    )
    .toBeUndefined();
  const offline = await page.request.get("/api/offline/catalog");
  expect(offline.status()).toBe(200);
  expect((await offline.json()).festivals.some((f) => f.slug === "rock-en-seine")).toBe(false);
  const raw = await db.festivalEdition.findUnique({ where: { id: editionId } });
  expect(raw.ticketStatus).toBe("AVAILABLE");
  expect(raw.startDate.toISOString()).toBe("2027-08-25T00:00:00.000Z");
});
