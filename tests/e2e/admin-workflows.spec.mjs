import { createPrismaClient } from "../../lib/prisma-client.mjs";
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
    page
      .locator("article.reviewCard")
      .filter({ hasText: "Browser Metal Festival" })
      .locator(".reviewMeta .safe"),
  ).toHaveText("approved");
  await page.getByRole("button", { name: "Festivals & artists" }).click();
  await page.getByLabel("City").fill("Sample E2E City");
  await page.getByRole("button", { name: "Save festival draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  await page.getByPlaceholder("Find an artist").fill("Sample Artist");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Canonical name").fill("Sample Artist E2E");
  await page.getByRole("button", { name: "Save artist draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  await page.getByRole("button", { name: "Links & assets" }).click();
  await page.getByLabel("Tickets URL").fill("https://tickets.example.test/wacken");
  await page.getByLabel("Logo URL").fill("https://assets.example.test/wacken.svg");
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
    page.getByRole("button", { name: "Save asset draft" }).click(),
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
  await page.getByRole("button", { name: "View parser log" }).click();

  const snapshot = await (await page.request.get("/api/admin")).json();
  expect(snapshot.drafts).toHaveLength(5);
  expect(snapshot.resources.find((item) => item.resourceKind === "FESTIVAL")?.values.city).toBe(
    "Sample E2E City",
  );
  expect(new Set(snapshot.drafts.map((item) => item.resourceKind))).toEqual(
    new Set(["FESTIVAL", "ARTIST", "LINK", "ASSET", "PLAYLIST"]),
  );

  const editorial = {
    en: {
      sections: [
        "Review queue",
        "Festival submissions",
        "Festivals & artists",
        "Links & assets",
        "Parser diagnostics",
        "Audit history",
      ],
      artist: "Artist editor",
      refresh: "Manual refresh",
      city: "City",
      save: "Save festival draft",
      playlist: "Playlist editor",
      savePlaylist: "Save playlist draft",
      publication: "Publication status",
      published: "Published",
      history: "History",
      approved: "approved",
      failed: "Failed",
      showLog: "View parser log",
      log: "synthetic-fest parser log",
      saved: /Draft revision \d+ persisted and queued/,
      refreshFailed: /Source check failed/,
    },
    de: {
      sections: [
        "Prüfwarteschlange",
        "Festivalvorschläge",
        "Festivals & Künstler",
        "Links & Medien",
        "Parser-Diagnose",
        "Prüfverlauf",
      ],
      artist: "Künstlereditor",
      refresh: "Manuelle Aktualisierung",
      city: "Stadt",
      save: "Festivalentwurf speichern",
      playlist: "Playlist-Editor",
      savePlaylist: "Playlistentwurf speichern",
      publication: "Veröffentlichungsstatus",
      published: "Veröffentlicht",
      history: "Verlauf",
      approved: "freigegeben",
      failed: "Fehlgeschlagen",
      showLog: "Parser-Protokoll anzeigen",
      log: "Parser-Protokoll für synthetic-fest",
      saved: /Entwurfsversion \d+ gespeichert/,
      refreshFailed: /Quellenprüfung fehlgeschlagen/,
    },
    ru: {
      sections: [
        "Очередь проверки",
        "Предложения фестивалей",
        "Фестивали и артисты",
        "Ссылки и материалы",
        "Диагностика парсера",
        "Журнал аудита",
      ],
      artist: "Редактор артистов",
      refresh: "Ручное обновление",
      city: "Город",
      save: "Сохранить черновик фестиваля",
      playlist: "Редактор плейлистов",
      savePlaylist: "Сохранить черновик плейлиста",
      publication: "Статус публикации",
      published: "Опубликовано",
      history: "История",
      approved: "подтверждено",
      failed: "Ошибка",
      showLog: "Открыть журнал парсера",
      log: "Журнал парсера: synthetic-fest",
      saved: /Версия черновика \d+ сохранена/,
      refreshFailed: /Не удалось проверить источник/,
    },
  };
  await page.route("**/api/admin/refresh/**", (route) =>
    route.fulfill({ status: 502, json: { error: "Raw upstream error" } }),
  );
  const draftFestival = { en: "synthetic-fest", de: "synthetic-alpine", ru: "synthetic-west" };
  for (const width of [1280, 320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [language, copy] of Object.entries(editorial)) {
      await page.locator(".adminLanguage select").selectOption(language);
      const open = (section) => page.getByRole("button", { name: section }).click();

      await open(copy.sections[0]);
      await expect(page.locator(".reviewList")).toBeVisible();
      await open(copy.sections[1]);
      const existing = page.locator(".reviewCard").filter({ hasText: "Browser Metal Festival" });
      await expect(existing.locator(".reviewMeta .safe")).toHaveText(copy.approved);
      await expect(existing).toContainText(copy.history + ":");
      await expect(existing).toContainText("Browser-created durable submission");
      await expect(existing).toContainText("https://browser-festival.example.test/official");
      await open(copy.sections[2]);
      await expect(page.getByRole("heading", { name: copy.artist })).toBeVisible();
      await expect(page.getByRole("heading", { name: copy.refresh })).toBeVisible();
      if (width === 1280) {
        await page
          .locator(".editorGrid .adminPanel")
          .first()
          .getByRole("combobox")
          .first()
          .selectOption(draftFestival[language]);
        await page
          .getByLabel(copy.city, { exact: true })
          .fill(`Localized synthetic city ${language}`);
        await page.getByRole("button", { name: copy.save }).click();
        await expect(page.getByRole("status")).toContainText(copy.saved);
        await page
          .locator(".adminPanel")
          .filter({ has: page.getByRole("heading", { name: copy.refresh }) })
          .getByRole("button")
          .click();
        await expect(page.getByRole("status")).toContainText(copy.refreshFailed);
        await expect(page.getByRole("status")).not.toContainText("Raw upstream error");
      }
      await open(copy.sections[3]);
      await expect(page.getByRole("heading", { name: copy.playlist })).toBeVisible();
      await expect(page.getByRole("button", { name: copy.savePlaylist })).toBeVisible();
      const publication = page.getByLabel(copy.publication);
      await expect(publication.locator("option[value=published]")).toHaveText(copy.published);
      await expect(publication).toHaveValue("published");
      await open(copy.sections[4]);
      await expect(page.locator(".diagnosticGrid .reviewMeta")).toContainText(copy.failed);
      await expect(page.getByText("E2E adapter failure", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: copy.showLog }).click();
      await expect(page.getByLabel(copy.log)).toContainText('"message": "fixture"');
      await page.getByRole("button", { name: copy.showLog }).click();
      await open(copy.sections[5]);
      await expect(page.getByText("CHANGE_APPROVED", { exact: true })).toBeVisible();

      for (const section of copy.sections) {
        await open(section);
        const layout = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          main: document.querySelector(".adminMain")?.scrollWidth,
        }));
        expect(
          layout.document,
          `${language} / ${section} at ${width}px: ${JSON.stringify(layout)}`,
        ).toBeLessThanOrEqual(layout.viewport);
      }
    }
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
