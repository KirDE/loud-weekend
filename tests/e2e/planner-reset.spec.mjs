import { expect, test } from "@playwright/test";

const key = "festival-radar-planner-v1";
const saved = {
  favoriteFestivals: ["synthetic-fest"],
  favoriteArtists: ["sample-artist"],
  attendance: { "synthetic-fest": "going" },
  playlistFestivals: ["synthetic-fest"],
  savedFilters: {
    query: "saved-query",
    country: "DE",
    month: "06",
    announcedOnly: true,
    ticketsOnly: true,
  },
};
const empty = {
  favoriteFestivals: [],
  favoriteArtists: [],
  attendance: {},
  playlistFestivals: [],
  savedFilters: {
    query: "",
    country: "all",
    month: "all",
    announcedOnly: false,
    ticketsOnly: false,
  },
};
const copy = {
  en: {
    clear: "Clear local data",
    title: "Reset this browser's plan?",
    cancel: "Cancel",
    reset: "Reset local plan",
    backup: "Download plan backup (.json)",
    undo: "Undo local reset",
    sync: "Sync now",
  },
  de: {
    clear: "Lokale Daten löschen",
    title: "Plan in diesem Browser zurücksetzen?",
    cancel: "Abbrechen",
    reset: "Lokalen Plan zurücksetzen",
    backup: "Plansicherung herunterladen (.json)",
    undo: "Lokales Zurücksetzen rückgängig machen",
    sync: "Jetzt synchronisieren",
  },
  ru: {
    clear: "Удалить локальные данные",
    title: "Сбросить план в этом браузере?",
    cancel: "Отмена",
    reset: "Сбросить локальный план",
    backup: "Скачать резервную копию плана (.json)",
    undo: "Отменить локальный сброс",
    sync: "Синхронизировать",
  },
};

async function setup(page, signedIn) {
  let writes = 0;
  await page.addInitScript(
    ({ key, saved }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem("synthetic-unrelated-preference", "keep");
    },
    { key, saved },
  );
  await page.route("**/api/auth/me*", (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn
        ? { user: { id: "synthetic-user", email: "planner@example.test" } }
        : { error: "unauthorized" },
    }),
  );
  await page.route("**/api/sync/*", (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: { document: null } });
  });
  await page.route("**/api/spotify/status*", (route) =>
    route.fulfill({ json: { connection: null } }),
  );
  return () => writes;
}
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);

for (const locale of ["en", "de", "ru"]) {
  for (const signedIn of [false, true]) {
    test(
      `${locale}` +
        ": reset is confirmed, cancellable and recoverable (" +
        `${signedIn ? "signed in" : "signed out"}` +
        ")",
      async ({ page }) => {
        const writes = await setup(page, signedIn);
        const t = copy[locale];
        await page.goto(`/${locale}/planner/`);
        const clear = page.getByRole("button", { name: t.clear, exact: true });
        await expect(clear).toBeEnabled();
        await clear.click();
        const dialog = page.getByRole("dialog", { name: t.title });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("button", { name: t.cancel, exact: true })).toBeFocused();
        expect(await state(page)).toEqual(saved);
        const data = await dialog.getByRole("link", { name: t.backup }).getAttribute("href");
        expect(JSON.parse(decodeURIComponent(data.split(",").slice(1).join(",")))).toEqual(saved);
        await dialog.getByRole("button", { name: t.cancel, exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(clear).toBeFocused();
        expect(await state(page)).toEqual(saved);
        await clear.click();
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(clear).toBeFocused();
        expect(await state(page)).toEqual(saved);
        await clear.click();
        await dialog.getByRole("button", { name: t.reset, exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect.poll(() => state(page)).toEqual(empty);
        await page.getByRole("button", { name: t.undo }).click();
        await expect.poll(() => state(page)).toEqual(saved);
        await page.reload();
        await expect(clear).toBeEnabled();
        await expect.poll(() => state(page)).toEqual(saved);
        expect(writes()).toBe(0);
        expect(
          await page.evaluate(() => localStorage.getItem("synthetic-unrelated-preference")),
        ).toBe("keep");
      },
    );
  }
}

test("local reset waits for explicit account synchronization to finish", async ({ page }) => {
  await setup(page, true);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sync/*", async (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.fulfill({ json: { document: null } });
    await pending;
    const { payload } = request.postDataJSON();
    return route.fulfill({
      json: {
        document: {
          id: "synthetic-document",
          payload,
          revision: 1,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    });
  });
  await page.goto("/en/planner/");
  const clear = page.getByRole("button", { name: copy.en.clear, exact: true });
  await page.getByRole("button", { name: copy.en.sync, exact: true }).click();
  await expect(clear).toBeDisabled();
  expect(await state(page)).toEqual(saved);
  release();
  await expect(clear).toBeEnabled();
  expect(await state(page)).toEqual(saved);
});

test("undo merges the backup without removing selections made after reset", async ({ page }) => {
  await setup(page, false);
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: copy.en.clear, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: copy.en.reset, exact: true }).click();
  await expect.poll(() => state(page)).toEqual(empty);
  await page
    .locator(".playlistFestivalGrid label")
    .filter({ hasText: "Synthetic South" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: copy.en.undo }).click();
  await expect
    .poll(async () => (await state(page)).playlistFestivals.slice().sort())
    .toEqual(["synthetic-fest", "synthetic-south"]);
});

test("backup, reset and undo include edition running orders without writing the account", async ({
  page,
}) => {
  const writes = await setup(page, true);
  const current = "festival-radar-timetable-v1:synthetic-fest:2027";
  const archive = "festival-radar-timetable-v1:synthetic-fest:2026";
  const unrelated = "festival-radar-timetable-v1:settings";
  await page.goto("/en/planner/");
  await page.evaluate(
    ({ current, archive, unrelated }) => {
      localStorage.setItem(current, '["show-1"]');
      localStorage.setItem(archive, '["archived-show"]');
      localStorage.setItem(unrelated, "keep");
    },
    { current, archive, unrelated },
  );
  await page.getByRole("button", { name: copy.en.clear, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const href = await dialog.getByRole("link", { name: copy.en.backup }).getAttribute("href");
  expect(JSON.parse(decodeURIComponent(href.split(",")[1])).runningOrders).toEqual({
    [current]: ["show-1"],
    [archive]: ["archived-show"],
  });
  await dialog.getByRole("button", { name: copy.en.reset, exact: true }).click();
  expect(
    await page.evaluate(
      (keys) => keys.map((key) => localStorage.getItem(key)),
      [current, archive, unrelated],
    ),
  ).toEqual([null, null, "keep"]);
  await page.evaluate((key) => localStorage.setItem(key, '["new-show"]'), current);
  await page.getByRole("button", { name: copy.en.undo }).click();
  expect(
    await page.evaluate(
      (keys) => keys.map((key) => localStorage.getItem(key)),
      [current, archive, unrelated],
    ),
  ).toEqual(['["new-show","show-1"]', '["archived-show"]', "keep"]);
  expect(writes()).toBe(0);
});
