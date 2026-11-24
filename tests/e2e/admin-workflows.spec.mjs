import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";

const db = createPrismaClient();

test.beforeAll(async () => {
  if (
    !process.env.DATABASE_URL ||
    !/(?:test|integration)/i.test(new URL(process.env.DATABASE_URL).pathname)
  )
    throw new Error("A test DATABASE_URL is required");
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AdminChange", "AdminDraft", "AdminParserRun"' +
      ', "AdminResourceState", "AdminAuditEntry", "Session", "User"' +
      " CASCADE",
  );
});

test.afterAll(async () => db.$disconnect());

test("admin edits, reviews, diagnostics and audit survive reload", async ({ page }) => {
  await expect((await page.request.get("/api/admin")).status()).toBe(403);
  await page.goto("/submit");
  await page.getByLabel("Festival name").fill("Browser Metal Festival");
  await page
    .getByLabel("Official source URL")
    .fill("https://browser-festival.example.test/official");
  await page.getByLabel("Edition year").fill("2029");
  await page.getByLabel("Notes").fill("Browser-created durable submission");
  await page.getByRole("button", { name: "Send for editorial review" }).click();
  await expect(page.getByRole("status")).toContainText("Received for review");
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: { email: "browser-admin@example.test", password: "correct horse battery staple" },
      })
    ).status(),
  ).toBe(201);
  await db.user.update({ where: { email: "browser-admin@example.test" }, data: { role: "ADMIN" } });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Detected changes" })).toBeVisible();
  // Switching must preserve the authenticated document, including its query and hash.
  await page.goto("/admin/?section=review#main-content");
  await expect
    .poll(() =>
      page
        .locator(".adminLanguage select")
        .evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
  const adminUrl = page.url();
  await page.evaluate(() => {
    window.__adminLanguageDocument = 42;
  });
  for (const language of ["de", "ru", "en"]) {
    await page.locator(".adminLanguage select").selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    expect(page.url()).toBe(adminUrl);
    expect(await page.evaluate(() => window.__adminLanguageDocument)).toBe(42);
  }
  await page.locator(".adminLanguage select").selectOption("de");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(page.url()).toBe(adminUrl);
  await page.locator(".adminLanguage select").selectOption("en");

  await expect(page.locator(".adminRole")).toContainText("Administrator");
  await expect(page.locator(".adminRole")).toContainText("browser-admin@example.test");
  await page.getByRole("button", { name: /Festival submissions/ }).click();
  const submission = page
    .locator("article.reviewCard")
    .filter({ hasText: "Browser Metal Festival" });
  await expect(submission).toContainText("Browser-created durable submission");
  await submission.getByRole("button", { name: "Approve submission" }).click();
  await expect(submission).toContainText("approved");
  await page.reload();
  await page.getByRole("button", { name: /Festival submissions/ }).click();
  await expect(
    page.locator("article.reviewCard").filter({ hasText: "Browser Metal Festival" }),
  ).toContainText("APPROVED");
  await page.getByRole("button", { name: "Festivals & artists" }).click();
  await page.getByLabel("City").fill("Sample E2E City");
  await page.getByRole("button", { name: "Save festival draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  const sampledArtist = await db.artist.findUniqueOrThrow({ where: { slug: "sample-artist" } });
  const site = "https://sample-artist.example.test/";
  const social = "https://www.instagram.com/sample-artist/";
  await db.artistLink.createMany({
    skipDuplicates: true,
    data: [
      {
        artistId: sampledArtist.id,
        url: site,
        label: "Official site",
        source: "official",
        verified: true,
      },
      {
        artistId: sampledArtist.id,
        url: social,
        label: "Social profile",
        source: "musicbrainz",
        verified: false,
        position: 1,
      },
    ],
  });
  await page.reload();
  await page.getByRole("button", { name: "Festivals & artists" }).click();
  await page.getByPlaceholder("Find an artist").fill("Sample Artist");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Canonical name").fill("Sample Artist E2E");
  await page.getByRole("button", { name: "Save artist draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  await page.getByLabel("Official evidence URL").fill(site + "social/");
  const queuedSocial = page.waitForResponse(
    (response) =>
      response.status() === 201 &&
      response.request().method() === "POST" &&
      response.request().postData()?.includes('"socialProfile"'),
  );
  await page.getByRole("button", { name: "Queue social profile for review" }).click();
  await queuedSocial;
  expect(
    await db.artistLink.findFirstOrThrow({ where: { artistId: sampledArtist.id, url: social } }),
  ).toMatchObject({ verified: false });

  await page.getByRole("button", { name: "Links & assets" }).click();
  await page.getByLabel("Tickets URL").fill("https://tickets.example.test/wacken");
  const logoBytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ac5" },
  })
    .png()
    .toBuffer();
  const logoHash = createHash("sha256").update(logoBytes).digest("hex");
  await db.assetBlob.upsert({
    where: { sha256: logoHash },
    create: {
      sha256: logoHash,
      mimeType: "image/png",
      sizeBytes: logoBytes.length,
      bytes: logoBytes,
    },
    update: {},
  });
  await page.getByLabel("Reviewed logo SHA-256").fill(logoHash);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin") &&
        response.request().method() === "POST" &&
        response.request().postData()?.includes('"resourceKind":"link"'),
    ),
    page.getByRole("button", { name: "Save links draft" }).click(),
  ]);
  await page.getByLabel("Playlist URL").fill("https://open.spotify.com/playlist/e2e");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin") &&
        response.request().method() === "POST" &&
        response.request().postData()?.includes('"resourceKind":"playlist"'),
    ),
    page.getByRole("button", { name: "Save playlist draft" }).click(),
  ]);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin") &&
        response.request().method() === "POST" &&
        response.request().postData()?.includes('"resourceKind":"asset"'),
    ),
    page.getByRole("button", { name: "Save logo draft" }).click(),
  ]);

  await page.reload();
  await page.getByRole("button", { name: "Review queue" }).click();
  const cityChange = page.locator("article.reviewCard").filter({ hasText: "Sample E2E City" });
  await expect(cityChange).toBeVisible();
  await cityChange.getByRole("button", { name: "Approve change" }).click();
  await expect(cityChange).toContainText("approved");

  await page.reload();
  await page.getByRole("button", { name: "Audit history" }).click();
  await expect(page.getByText("CHANGE_APPROVED")).toBeVisible();
  await expect(page.getByText("DRAFT_SAVED").first()).toBeVisible();

  await db.adminParserRun.create({
    data: {
      festivalSlug: "synthetic-fest",
      sourceId: "e2e-source",
      adapter: "e2e-adapter",
      status: "FAILED",
      finishedAt: new Date(),
      durationMs: 17,
      message: "E2E adapter failure",
      log: [{ message: "fixture" }],
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "Parser diagnostics" }).click();
  await expect(page.getByText("E2E adapter failure")).toBeVisible();
  await page.getByRole("button", { name: "View parser log" }).click();
  await expect(page.getByLabel("synthetic-fest parser log")).toContainText("fixture");

  const snapshot = await (await page.request.get("/api/admin")).json();
  expect(snapshot.drafts).toHaveLength(6);
  expect(snapshot.resources.find((item) => item.resourceKind === "FESTIVAL")?.values.city).toBe(
    "Sample E2E City",
  );
  expect(new Set(snapshot.drafts.map((item) => item.resourceKind))).toEqual(
    new Set(["FESTIVAL", "ARTIST", "LINK", "ASSET", "PLAYLIST"]),
  );

  const sections = [
    "Review queue",
    "Festival submissions",
    "Festivals & artists",
    "Links & assets",
    "Parser diagnostics",
    "Audit history",
  ];
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of sections) {
      await page.getByRole("button", { name: new RegExp(name) }).click();
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        nav: document.querySelector(".adminNav")?.scrollWidth,
        main: document.querySelector(".adminMain")?.scrollWidth,
      }));
      expect(
        layout.document,
        `${name} at ${width}px: ${JSON.stringify(layout)}`,
      ).toBeLessThanOrEqual(layout.viewport);
    }
  }
});

test("artist favorites survive canonical renames and legacy names can be removed", async ({
  page,
}) => {
  const original = await db.artist.findUniqueOrThrow({ where: { slug: "sample-artist" } });
  await page.addInitScript((name) => {
    const key = "festival-radar-planner-v1";
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ favoriteArtists: [name] }));
  }, original.name);
  const renamed = "Sample Artist Reviewed";
  await db.artist.update({
    where: { id: original.id },
    data: { name: renamed, aliases: [...original.aliases, original.name] },
  });
  try {
    await page.goto("/artists/sample-artist/");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    const favorite = page.locator(".favoriteButton");
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "false");
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("festival-radar-planner-v1")).favoriteArtists,
        ),
      )
      .toEqual(["artist:sample-artist"]);
    await page.goto("/planner/");
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  } finally {
    await db.artist.update({
      where: { id: original.id },
      data: { name: original.name, aliases: original.aliases },
    });
  }
});

test("editor identity is rendered truthfully", async ({ page }) => {
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: { email: "browser-editor@example.test", password: "correct horse battery staple" },
      })
    ).status(),
  ).toBe(201);
  await db.user.update({
    where: { email: "browser-editor@example.test" },
    data: { role: "EDITOR" },
  });
  await page.goto("/admin");
  await expect(page.locator(".adminRole")).toContainText("Editor · Review required");
  await expect(page.locator(".adminRole")).toContainText("browser-editor@example.test");
  await expect(page.getByRole("heading", { name: "Manual refresh" })).toHaveCount(0);
  expect((await page.request.post("/api/admin/refresh/synthetic-fest")).status()).toBe(403);
});

test("allowlisted USER cannot enter or mutate the admin console", async ({ page }) => {
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: { email: "browser-viewer@example.test", password: "correct horse battery staple" },
      })
    ).status(),
  ).toBe(201);
  expect((await page.request.get("/api/admin")).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/admin", {
        data: {
          resourceKind: "festival",
          resourceKey: "denied",
          baseRevision: 0,
          values: { city: "denied" },
        },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\?admin=forbidden$/);
});
