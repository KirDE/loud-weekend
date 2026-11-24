import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const storageKey = "festival-radar-planner-v1";
const legacyFilters = {
  query: "Synthetic",
  country: "DE",
  month: "06",
  announcedOnly: true,
  ticketsOnly: false,
};
const activeFilters = {
  ...legacyFilters,
  ticketsOnly: true,
  genre: "doom metal",
  origin: "cologne",
  maxDistance: "500",
};

async function expectFilters(page, filters) {
  await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByRole("textbox", { name: "Search festivals, artists or cities" }),
  ).toHaveValue(filters.query);
  const expectedSelects = {
    countries: filters.country,
    "Filter by month": filters.month,
    "Filter by genre": filters.genre,
    "Distance origin": filters.origin,
    "Maximum distance": filters.maxDistance,
  };
  for (const [name, value] of Object.entries(expectedSelects)) {
    await expect(page.getByRole("combobox", { name, exact: true })).toHaveValue(value);
  }
  await expect(page.locator(".filterToggles input").nth(0)).toBeChecked({
    checked: filters.announcedOnly,
  });
  await expect(page.locator(".filterToggles input").nth(1)).toBeChecked({
    checked: filters.ticketsOnly,
  });
}

test("legacy discovery filters migrate, persist and sync to an independent browser context", async ({
  page,
  browser,
  baseURL,
}) => {
  const credentials = {
    email: `discovery-${randomUUID()}@example.test`,
    password: "synthetic discovery test password",
  };
  await page.addInitScript(
    ({ key, filters }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ savedFilters: filters }));
    },
    { key: storageKey, filters: legacyFilters },
  );
  await page.goto("/en/");
  await expectFilters(page, {
    ...legacyFilters,
    genre: "all",
    origin: "berlin",
    maxDistance: "all",
  });
  await expect(page.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);

  await page.getByRole("combobox", { name: "Filter by genre" }).selectOption(activeFilters.genre);
  await page.getByRole("combobox", { name: "Distance origin" }).selectOption(activeFilters.origin);
  await page
    .getByRole("combobox", { name: "Maximum distance" })
    .selectOption(activeFilters.maxDistance);
  await expect(page.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);
  await page.getByText("Official tickets only", { exact: true }).click();
  await expect(page.locator(".festivalCard")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)).savedFilters, storageKey),
    )
    .toEqual(activeFilters);
  await page.reload();
  await expectFilters(page, activeFilters);
  await expect(page.locator(".festivalCard")).toHaveCount(0);

  expect((await page.request.post("/api/auth/register", { data: credentials })).status()).toBe(201);
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Everything is synchronized.")).toBeVisible();
  const document = await page.request.get("/api/sync/saved-filters/");
  expect((await document.json()).document.payload.savedFilters).toEqual(activeFilters);

  const secondDevice = await browser.newContext({ baseURL });
  try {
    const secondPage = await secondDevice.newPage();
    expect((await secondPage.request.post("/api/auth/login", { data: credentials })).ok()).toBe(
      true,
    );
    await secondPage.goto("/en/planner/");
    await secondPage
      .getByRole("button", { name: "Use account data on this device", exact: true })
      .click();
    await expect(secondPage.getByText("Everything is synchronized.")).toBeVisible();
    await secondPage.goto("/en/");
    await expectFilters(secondPage, activeFilters);
    await expect(secondPage.locator(".festivalCard")).toHaveCount(0);
    await secondPage.goto("/de/");
    await expect
      .poll(() =>
        secondPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).savedFilters,
          storageKey,
        ),
      )
      .toEqual(activeFilters);
    await expect(secondPage.locator(".festivalCard")).toHaveCount(0);

    // Leave the second device on the same planner page while the first device saves.
    await secondPage.goto("/en/planner/");
    const pull = secondPage.getByRole("button", {
      name: "Use account data on this device",
      exact: true,
    });
    await expect(pull).toBeEnabled();
    const latest = { ...activeFilters, ticketsOnly: false };
    const { document: previous } = await (
      await page.request.get("/api/sync/saved-filters/")
    ).json();
    expect(
      (
        await page.request.put("/api/sync/saved-filters/", {
          headers: { origin: new URL(page.url()).origin },
          data: { revision: previous.revision, payload: { savedFilters: latest } },
        })
      ).status(),
    ).toBe(200);

    // A failed document read must not replace any local data.
    const filtersRoute = "**/api/sync/saved-filters*";
    const invalidPayload = {
      json: { document: { ...previous, payload: { savedFilters: "invalid" } } },
    };
    // A 409 followed by a malformed read must not offer a destructive choice.
    await secondPage.route(filtersRoute, (route) =>
      route.request().method() === "GET" ? route.fulfill(invalidPayload) : route.continue(),
    );
    await secondPage.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(secondPage.getByText("Sync failed. Reconnect and try again.")).toBeVisible({
      timeout: 5000,
    });
    await expect(
      secondPage.getByRole("button", { name: "Use other device", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        secondPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).savedFilters,
          storageKey,
        ),
      )
      .toEqual(activeFilters);
    await secondPage.unroute(filtersRoute);

    const invalidFields = {
      json: {
        document: {
          ...previous,
          payload: { savedFilters: { ...activeFilters, origin: 42, ticketsOnly: "true" } },
        },
      },
    };
    for (const response of [{ status: 503 }, { json: {} }, invalidPayload, invalidFields]) {
      await secondPage.route(filtersRoute, (route) => route.fulfill(response));
      await pull.click();
      await expect(secondPage.getByText("Sync failed. Reconnect and try again.")).toBeVisible();
      await expect
        .poll(() =>
          secondPage.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)).savedFilters,
            storageKey,
          ),
        )
        .toEqual(activeFilters);
      await secondPage.unroute(filtersRoute);
    }

    const plansRoute = "**/api/sync/plans*";
    const { document: plans } = await (await page.request.get("/api/sync/plans/")).json();
    await secondPage.route(plansRoute, (route) =>
      route.fulfill({
        json: { document: { ...plans, payload: { attendance: "invalid" } } },
      }),
    );
    await pull.click();
    await expect(secondPage.getByText("Sync failed. Reconnect and try again.")).toBeVisible();
    await expect
      .poll(() =>
        secondPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).savedFilters,
          storageKey,
        ),
      )
      .toEqual(activeFilters);
    await secondPage.unroute(plansRoute);

    // A valid older plan may contain extra fields. They do not own discovery preferences.
    await secondPage.route(plansRoute, (route) =>
      route.fulfill({
        json: { document: { ...plans, payload: { attendance: {}, savedFilters: activeFilters } } },
      }),
    );
    await pull.click();
    await expect(secondPage.getByText("Everything is synchronized.")).toBeVisible();
    await secondPage.unroute(plansRoute);
    await secondPage.goto("/en/");
    await expectFilters(secondPage, latest);
    await expect(secondPage.locator(".festivalCard h2")).toHaveText(["Synthetic Fest"]);
  } finally {
    await secondDevice.close();
  }
});

test("taking remote favorites leaves unrelated unsynced planner data on this device", async ({
  page,
}) => {
  const local = {
    favoriteFestivals: ["local-festival"],
    favoriteArtists: ["local-artist"],
    attendance: { "local-festival": "going" },
    playlistFestivals: ["local-playlist"],
    savedFilters: activeFilters,
  };
  await page.addInitScript(
    ({ key, planner }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(planner));
    },
    { key: storageKey, planner: local },
  );

  const credentials = {
    email: `discovery-conflict-${randomUUID()}@example.test`,
    password: "synthetic conflict test password",
  };
  expect((await page.request.post("/api/auth/register", { data: credentials })).status()).toBe(201);
  await page.goto("/en/planner/");
  const pull = page.getByRole("button", { name: "Use account data on this device", exact: true });
  await expect(pull).toBeDisabled();

  // Another device creates favorites before this one tries to sync its local version.
  const remote = { favoriteFestivals: ["remote-festival"], favoriteArtists: [] };
  expect(
    (
      await page.request.put("/api/sync/favorites/", {
        headers: { origin: new URL(page.url()).origin },
        data: { revision: 0, payload: remote },
      })
    ).status(),
  ).toBe(201);

  const favoritesRoute = "**/api/sync/favorites*";
  const { document } = await (await page.request.get("/api/sync/favorites/")).json();
  await page.route(favoritesRoute, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: { document: { ...document, payload: { favoriteFestivals: [false] } } },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Sync failed. Reconnect and try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use other device", exact: true })).toHaveCount(0);
  await page.unroute(favoritesRoute);

  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  const useRemote = page.getByRole("button", { name: "Use other device", exact: true });
  await expect(useRemote).toBeVisible();

  // A further account save after the conflict must not be replaced by the stale snapshot.
  const latest = { ...remote, favoriteArtists: ["new-remote-artist"] };
  expect(
    (
      await page.request.put("/api/sync/favorites/", {
        headers: { origin: new URL(page.url()).origin },
        data: { revision: document.revision, payload: latest },
      })
    ).status(),
  ).toBe(200);

  await page.route(favoritesRoute, (route) => route.fulfill({ status: 503 }));
  await useRemote.click();
  await expect(page.getByText("Sync failed. Reconnect and try again.")).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey))
    .toEqual(local);
  await page.unroute(favoritesRoute);

  await useRemote.click();
  await expect(
    page.getByText("Conflict resolved. Sync again to send other local changes."),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey))
    .toEqual({ ...local, ...latest });

  const savedFilters = await page.request.get("/api/sync/saved-filters/");
  expect((await savedFilters.json()).document).toBeNull();
});

test("keeping this device during a sync conflict sends the newest local attendance", async ({
  page,
}) => {
  const local = { attendance: { "synthetic-fest": "going" } };
  await page.addInitScript(
    ({ key, planner }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(planner));
    },
    { key: storageKey, planner: local },
  );

  const credentials = {
    email: `discovery-keep-device-${randomUUID()}@example.test`,
    password: "synthetic conflict test password",
  };
  expect((await page.request.post("/api/auth/register", { data: credentials })).status()).toBe(201);
  await page.goto("/en/planner/");
  const attendance = page.locator(".planList select");
  await expect(attendance).toHaveValue("going");
  const sync = page.getByRole("button", { name: "Sync now", exact: true });
  await sync.click();
  await expect(page.getByText("Everything is synchronized.")).toBeVisible();

  const plansUrl = "/api/sync/plans/";
  const { document } = await (await page.request.get(plansUrl)).json();
  expect(
    (
      await page.request.put(plansUrl, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          revision: document.revision,
          payload: { attendance: { "synthetic-fest": "not-going" } },
        },
      })
    ).status(),
  ).toBe(200);

  await sync.click();
  const keepLocal = page.getByRole("button", { name: "Keep this device", exact: true });
  await expect(keepLocal).toBeVisible();
  await attendance.selectOption("maybe");
  await keepLocal.click();
  await expect(
    page.getByText("Conflict resolved. Sync again to send other local changes."),
  ).toBeVisible();
  await expect(attendance).toHaveValue("maybe");
  const saved = await (await page.request.get(plansUrl)).json();
  expect(saved.document.payload.attendance).toEqual({ "synthetic-fest": "maybe" });
});

test("taking a remote plan preserves attendance changed while the account read is pending", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ attendance: { "synthetic-fest": "going" } }));
    }
  }, storageKey);
  const credentials = {
    email: `discovery-pending-remote-${randomUUID()}@example.test`,
    password: "synthetic conflict test password",
  };
  expect((await page.request.post("/api/auth/register", { data: credentials })).status()).toBe(201);
  await page.goto("/en/planner/");
  const sync = page.getByRole("button", { name: "Sync now", exact: true });
  await sync.click();
  await expect(page.getByText("Everything is synchronized.")).toBeVisible();

  const plansUrl = "/api/sync/plans/";
  const { document } = await (await page.request.get(plansUrl)).json();
  expect(
    (
      await page.request.put(plansUrl, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          revision: document.revision,
          payload: { attendance: { "synthetic-fest": "not-going" } },
        },
      })
    ).status(),
  ).toBe(200);
  await sync.click();
  const useRemote = page.getByRole("button", { name: "Use other device", exact: true });
  await expect(useRemote).toBeVisible();

  const readStarted = Promise.withResolvers();
  const releaseRead = Promise.withResolvers();
  const pattern = "**/api/sync/plans*";
  await page.route(pattern, async (route) => {
    readStarted.resolve();
    await releaseRead.promise;
    await route.continue();
  });
  const attendance = page.locator(".planList select");
  try {
    await useRemote.click();
    await readStarted.promise;
    await attendance.selectOption("maybe");
  } finally {
    releaseRead.resolve();
  }
  await expect(
    page.getByText("Conflict resolved. Sync again to send other local changes."),
  ).toBeVisible();
  await expect(attendance).toHaveValue("maybe", { timeout: 4000 });
  await page.unroute(pattern);

  await sync.click();
  await expect(page.getByText("Everything is synchronized.")).toBeVisible();
  const saved = await (await page.request.get(plansUrl)).json();
  expect(saved.document.payload.attendance).toEqual({ "synthetic-fest": "maybe" });
});
