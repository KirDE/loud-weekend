import { test, expect } from "@playwright/test";
const copy = {
  en: {
    import: "Import playlists",
    sync: "Sync now",
    remote: "Use account data on this device",
    merge: "Merge this device into my account",
    last: "Last successful import",
    saved: "Saved imported playlists",
    conflict: "A newer version exists on another device. Nothing was overwritten.",
    keep: "Keep this device",
  },
  de: {
    import: "Playlists importieren",
    sync: "Jetzt synchronisieren",
    remote: "Kontodaten auf diesem Gerät verwenden",
    merge: "Dieses Gerät mit meinem Konto zusammenführen",
    last: "Letzter erfolgreicher Import",
    saved: "Gespeicherte importierte Playlists",
    conflict: "Auf einem anderen Gerät gibt es eine neuere Version. Nichts wurde überschrieben.",
    keep: "Dieses Gerät behalten",
  },
  ru: {
    import: "Импортировать плейлисты",
    sync: "Синхронизировать",
    remote: "Использовать данные аккаунта на устройстве",
    merge: "Объединить данные устройства с аккаунтом",
    last: "Последний успешный импорт",
    saved: "Сохранённые импортированные плейлисты",
    conflict: "На другом устройстве есть более новая версия. Ничего не перезаписано.",
    keep: "Оставить данные устройства",
  },
};
const documentKinds = {
  favorites: "FAVORITES",
  collections: "COLLECTIONS",
  "saved-filters": "SAVED_FILTERS",
  plans: "FESTIVAL_PLANS",
};
const userId = "synthetic-user";
for (const [locale, t] of Object.entries(copy))
  test(
    locale +
      " imported Spotify collections survive ordinary/merge sync, reload, second device and conflict UI",
    async ({ page, context }) => {
      const imported = {
        syncedAt: "2026-11-17T22:00:00.000Z",
        playlists: [
          {
            id: "abc",
            name: "Synthetic retained playlist",
            url: "https://open.spotify.com/playlist/abc",
            image: null,
            owner: "Synthetic provider",
            trackCount: 3,
          },
        ],
      };
      const docs = {
        collections: {
          id: "collection",
          userId,
          kind: documentKinds.collections,
          revision: 1,
          updatedAt: imported.syncedAt,
          payload: { schemaVersion: 1, playlistFestivals: ["graspop"], spotify: null },
        },
      };
      let failImport = false,
        conflictNext = false,
        importRevisionConflict = false,
        invalidImport = true;
      await context.route("**/api/auth/me**", (route) =>
        route.fulfill({
          json: {
            user: {
              id: userId,
              email: "browser-collections@example.test",
              emailVerified: true,
              role: "USER",
            },
          },
        }),
      );
      await context.route("**/api/sync/**", async (route) => {
        const req = route.request(),
          kind = new URL(req.url()).pathname.split("/").filter(Boolean).at(-1);
        if (req.method() === "GET")
          return route.fulfill({ json: { document: docs[kind] ?? null } });
        const body = req.postDataJSON(),
          previous = docs[kind];
        if (kind === "collections" && conflictNext) {
          conflictNext = false;
          docs[kind] = {
            ...previous,
            revision: previous.revision + 1,
            payload: { ...previous.payload, playlistFestivals: ["reading"] },
          };
          return route.fulfill({ status: 409, json: { error: "conflict" } });
        }
        if ((previous?.revision ?? 0) !== body.revision)
          return route.fulfill({ status: 409, json: { error: "conflict" } });
        const payload =
          kind === "collections"
            ? {
                schemaVersion: 1,
                playlistFestivals: body.payload.playlistFestivals,
                spotify: previous?.payload.spotify ?? null,
              }
            : body.payload;
        docs[kind] = {
          id: previous?.id ?? kind,
          userId,
          kind: documentKinds[kind],
          revision: (previous?.revision ?? 0) + 1,
          updatedAt: imported.syncedAt,
          payload,
        };
        return route.fulfill({ json: { document: docs[kind] } });
      });
      await context.route("**/api/spotify/sync**", async (route) => {
        const previous = docs.collections;
        if (failImport)
          return route.fulfill({ status: 502, json: { error: "Synthetic upstream failure" } });
        if (importRevisionConflict) {
          importRevisionConflict = false;
          docs.collections = {
            ...previous,
            revision: previous.revision + 1,
            payload: { ...previous.payload, playlistFestivals: ["reading"] },
          };
          return route.fulfill({ status: 409, json: { error: "concurrent device write" } });
        }
        if (route.request().postDataJSON().revision !== previous.revision)
          return route.fulfill({ status: 409, json: { error: "conflict" } });
        if (invalidImport) {
          invalidImport = false;
          return route.fulfill({
            json: {
              document: { ...previous, payload: { ...previous.payload, spotify: imported } },
            },
          });
        }
        docs.collections = {
          ...previous,
          revision: previous.revision + 1,
          payload: { ...previous.payload, spotify: imported },
        };
        return route.fulfill({ json: { document: docs.collections } });
      });
      await page.addInitScript(() => {
        if (!localStorage.getItem("festival-radar-planner-v1"))
          localStorage.setItem(
            "festival-radar-planner-v1",
            JSON.stringify({
              favoriteFestivals: [],
              favoriteArtists: [],
              attendance: {},
              playlistFestivals: ["wacken-open-air"],
              savedFilters: {
                query: "",
                country: "all",
                announcedOnly: false,
                month: "all",
                ticketsOnly: false,
              },
            }),
          );
      });
      await page.goto("/" + locale + "/planner/");
      const panel = page.locator(".accountSync"),
        link = panel.getByRole("link", { name: "Synthetic retained playlist" });
      await panel.getByRole("button", { name: t.import, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(link).toHaveCount(0);
      await panel.getByRole("button", { name: t.import, exact: true }).click();
      await expect(link).toBeVisible();
      await expect(panel.getByRole("heading", { name: t.saved })).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", imported.syncedAt);
      expect(docs.collections.payload.playlistFestivals).toEqual(["graspop", "wacken-open-air"]);
      await panel.getByRole("button", { name: t.sync, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      expect(docs.collections.payload.spotify).toEqual(imported);
      await panel.getByRole("button", { name: t.merge, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(link).toBeVisible();
      await page.reload();
      await expect(link).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", imported.syncedAt);
      await panel.getByRole("button", { name: t.remote, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse(localStorage.getItem("festival-radar-planner-v1")).playlistFestivals.sort(),
          ),
        )
        .toEqual(["graspop", "wacken-open-air"]);
      const other = await context.newPage();
      await other.goto("/" + locale + "/planner/");
      await expect(
        other.locator(".accountSync").getByRole("link", { name: "Synthetic retained playlist" }),
      ).toBeVisible();
      await other.close();
      conflictNext = true;
      await panel.getByRole("button", { name: t.sync, exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText(t.conflict);
      await panel.getByRole("button", { name: t.keep, exact: true }).click();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      expect(docs.collections.payload.spotify).toEqual(imported);
      const unsynced = await page.evaluate(() => {
        const key = "festival-radar-planner-v1",
          state = JSON.parse(localStorage.getItem(key));
        Object.assign(state, {
          favoriteFestivals: ["synthetic-local-only"],
          favoriteArtists: ["Synthetic local artist"],
          attendance: { "synthetic-local-only": "maybe" },
          savedFilters: { ...state.savedFilters, query: "unsynchronized filter" },
        });
        localStorage.setItem(key, JSON.stringify(state));
        return state;
      });
      await page.reload();
      await expect(link).toBeVisible();
      importRevisionConflict = true;
      await panel.getByRole("button", { name: t.import, exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText(t.conflict);
      expect(docs.collections.payload.playlistFestivals).toEqual(["reading"]);
      await panel.getByRole("button", { name: t.sync, exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText(t.conflict);
      expect(docs.collections.payload.playlistFestivals).toEqual(["reading"]);
      const useRemote = {
        en: "Use other device",
        de: "Anderes Gerät verwenden",
        ru: "Взять данные другого устройства",
      }[locale];
      await panel.getByRole("button", { name: useRemote, exact: true }).click();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("festival-radar-planner-v1")).playlistFestivals,
          ),
        )
        .toEqual(["reading"]);
      const retained = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("festival-radar-planner-v1")),
      );
      for (const field of ["favoriteFestivals", "favoriteArtists", "attendance", "savedFilters"])
        expect(retained[field]).toEqual(unsynced[field]);

      failImport = true;
      await panel.getByRole("button", { name: t.import, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(link).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", imported.syncedAt);
    },
  );

test("Spotify import does not restore a selection removed while account sync is pending", async ({
  page,
}) => {
  const date = "2026-11-17T22:00:00.000Z";
  let replyToWrite, markWriteStarted;
  const releaseWrite = new Promise((resolve) => {
    replyToWrite = resolve;
  });
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve;
  });
  let saved;
  await page.route("**/api/auth/me**", (route) =>
    route.fulfill({
      json: {
        user: {
          id: userId,
          email: "browser-collections@example.test",
          emailVerified: true,
          role: "USER",
        },
      },
    }),
  );
  await page.route("**/api/sync/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { document: null } });
    saved = {
      id: "collection",
      userId,
      kind: documentKinds.collections,
      revision: 1,
      updatedAt: date,
      payload: request.postDataJSON().payload,
    };
    markWriteStarted();
    await releaseWrite;
    return route.fulfill({ json: { document: saved } });
  });
  await page.route("**/api/spotify/sync**", (route) =>
    route.fulfill({
      json: {
        document: {
          ...saved,
          revision: 2,
          payload: {
            ...saved.payload,
            spotify: { syncedAt: date, playlists: [] },
          },
        },
      },
    }),
  );

  await page.goto("/en/planner/");
  const choice = page.locator(".playlistFestivalGrid input").first();
  await choice.check();
  const panel = page.locator(".accountSync");
  await panel.getByRole("button", { name: copy.en.import, exact: true }).click();
  await writeStarted;
  try {
    expect(saved.payload.playlistFestivals).toHaveLength(1);
    await choice.uncheck();
  } finally {
    replyToWrite();
  }
  await expect(panel.getByText(copy.en.last)).toBeVisible();
  await expect(choice).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("festival-radar-planner-v1")).playlistFestivals,
      ),
    )
    .toEqual([]);
});

test("sync waits for a successful account baseline before saving", async ({ page }) => {
  const date = "2026-11-17T22:00:00.000Z";
  let releaseRead, markReadStarted;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise((resolve) => {
    markReadStarted = resolve;
  });
  const docs = {
    collections: {
      id: "existing-collection",
      userId,
      kind: documentKinds.collections,
      revision: 4,
      updatedAt: date,
      payload: { schemaVersion: 1, playlistFestivals: [], spotify: null },
    },
  };
  let writes = 0;
  let failFirstRead = true;
  await page.route("**/api/auth/me**", (route) =>
    route.fulfill({
      json: {
        user: { id: userId, email: "browser-collections@example.test" },
      },
    }),
  );
  await page.route("**/api/sync/**", async (route) => {
    const request = route.request();
    const kind = new URL(request.url()).pathname.split("/").filter(Boolean).at(-1);
    if (request.method() === "GET") {
      if (kind === "collections") {
        markReadStarted();
        await readGate;
        if (failFirstRead) {
          failFirstRead = false;
          return route.fulfill({ status: 503, json: { error: "Unavailable" } });
        }
      }
      return route.fulfill({ json: { document: docs[kind] ?? null } });
    }
    writes++;
    const { payload, revision } = request.postDataJSON();
    const previous = docs[kind];
    expect(revision).toBe(previous?.revision ?? 0);
    docs[kind] = {
      id: previous?.id ?? kind,
      userId,
      kind: documentKinds[kind],
      revision: revision + 1,
      updatedAt: date,
      payload,
    };
    return route.fulfill({ json: { document: docs[kind] } });
  });
  await page.goto("/en/planner/");
  await readStarted;
  const panel = page.locator(".accountSync");
  const sync = panel.getByRole("button", { name: copy.en.sync, exact: true });
  try {
    await expect(sync).toBeDisabled();
    expect(writes).toBe(0);
  } finally {
    releaseRead();
  }
  await expect(panel.getByText("Sync failed. Reconnect and try again.")).toBeVisible();
  await expect(sync).toBeDisabled();
  expect(writes).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("loud-weekend-authenticated")));
  await sync.click();
  await expect(panel.getByText("Everything is synchronized.")).toBeVisible();
  expect(writes).toBe(4);
  expect(docs.collections.revision).toBe(5);
});

test("signing out removes the private account view but keeps device choices", async ({ page }) => {
  const date = "2026-11-17T22:00:00.000Z";
  let signedIn = true;
  await page.route("**/api/auth/me**", (route) =>
    route.fulfill({
      json: {
        user: signedIn ? { id: userId, email: "browser-collections@example.test" } : null,
      },
    }),
  );
  await page.route("**/api/auth/logout**", (route) => {
    signedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sync/**", (route) => {
    const kind = new URL(route.request().url()).pathname.split("/").filter(Boolean).at(-1);
    const document =
      signedIn && kind === "collections"
        ? {
            id: "private-collection",
            userId,
            kind: documentKinds.collections,
            revision: 1,
            updatedAt: date,
            payload: {
              schemaVersion: 1,
              playlistFestivals: [],
              spotify: {
                syncedAt: date,
                playlists: [
                  {
                    id: "private",
                    name: "Synthetic private playlist",
                    url: "https://open.spotify.com/playlist/private",
                    image: null,
                    owner: "Synthetic provider",
                    trackCount: 1,
                  },
                ],
              },
            },
          }
        : null;
    return route.fulfill({ json: { document } });
  });
  await page.goto("/en/planner/");
  const panel = page.locator(".accountSync");
  await expect(panel.getByRole("link", { name: "Synthetic private playlist" })).toBeVisible();
  const choice = page.locator(".playlistFestivalGrid input").first();
  await choice.check();
  const selection = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("festival-radar-planner-v1"))?.playlistFestivals,
    );
  await expect.poll(selection).toHaveLength(1);
  const saved = await selection();

  await page.locator(".accountButton").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    panel.getByText("Sign in from the Account menu to enable cross-device sync."),
  ).toBeVisible();
  await expect(panel.getByRole("link", { name: "Synthetic private playlist" })).toHaveCount(0);
  await expect(choice).toBeChecked();
  expect(await selection()).toEqual(saved);
});
