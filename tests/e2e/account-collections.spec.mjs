import { test, expect } from "@playwright/test";
const copy = {
  en: {
    clear: "Clear local data",
    confirm: "Reset local plan",
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
    clear: "Lokale Daten löschen",
    confirm: "Lokalen Plan zurücksetzen",
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
    clear: "Удалить локальные данные",
    confirm: "Сбросить локальный план",
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
      let waitForCollectionSave;
      let failImport = false,
        conflictNext = false,
        importRevisionConflict = false;
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
        if (kind === "collections" && waitForCollectionSave) await waitForCollectionSave;
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
                playlistExcludedArtists:
                  body.payload.playlistExcludedArtists ?? previous?.payload.playlistExcludedArtists,
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
              playlistExcludedArtists: ["sample-artist"],
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
      await expect(link).toBeVisible();
      await expect(panel.getByRole("heading", { name: t.saved })).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", imported.syncedAt);
      expect(docs.collections.payload.playlistFestivals).toEqual(["graspop", "wacken-open-air"]);
      expect(docs.collections.payload.playlistExcludedArtists).toEqual(["sample-artist"]);
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

      expect(docs.collections.payload.playlistExcludedArtists).toEqual(["sample-artist"]);
      await page.getByRole("button", { name: t.clear, exact: true }).click();
      await page.getByRole("button", { name: t.confirm, exact: true }).click();
      await page.getByRole("checkbox", { name: "Synthetic Fest", exact: true }).check();
      await panel.getByRole("button", { name: t.sync, exact: true }).click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      expect(docs.collections.payload.playlistExcludedArtists).toEqual([]);
      expect(docs.collections.payload.spotify).toEqual(imported);
      failImport = true;
      const artistPicker = page.locator(".playlistArtistPicker");
      await artistPicker.locator("summary").click();
      const artist = artistPicker.getByRole("checkbox", { name: "Sample Artist", exact: true });
      await expect(artist).toBeEnabled();
      let releaseSave;
      waitForCollectionSave = new Promise((resolve) => {
        releaseSave = resolve;
      });
      const presave = page.waitForRequest(
        (request) =>
          request.method() === "PUT" && /\/api\/sync\/collections\/?$/.test(request.url()),
      );
      try {
        await panel.getByRole("button", { name: t.import, exact: true }).click();
        await presave;
        await expect(artist).toBeDisabled();
      } finally {
        releaseSave();
        waitForCollectionSave = undefined;
      }
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(artist).toBeEnabled();
      await expect(link).toBeVisible();
      await expect(panel.locator("time")).toHaveAttribute("datetime", imported.syncedAt);
      expect(docs.collections.payload.playlistExcludedArtists).toEqual([]);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("festival-radar-planner-v1")).playlistExcludedArtists,
          ),
        )
        .toEqual([]);
    },
  );
