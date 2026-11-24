import { expect, test } from "@playwright/test";

const labels = {
  en: {
    title: "Trip budgets",
    select: "Festival edition",
    fields: [
      "Ticket per person",
      "Travel for the group",
      "Lodging per night",
      "Food per person per day",
      "Days",
    ],
    save: "Save estimate",
    compare: "Compare saved estimates",
    download: "Download estimates (.json)",
  },
  de: {
    title: "Reisebudgets",
    select: "Festival-Ausgabe",
    fields: [
      "Ticket pro Person",
      "Anreise für die Gruppe",
      "Unterkunft pro Nacht",
      "Verpflegung pro Person und Tag",
      "Tage",
    ],
    save: "Schätzung speichern",
    compare: "Gespeicherte Schätzungen vergleichen",
    download: "Schätzungen herunterladen (.json)",
  },
  ru: {
    title: "Бюджеты поездок",
    select: "Выпуск фестиваля",
    fields: [
      "Билет на человека",
      "Дорога на группу",
      "Жильё за ночь",
      "Питание на человека в день",
      "Дней",
    ],
    save: "Сохранить оценку",
    compare: "Сравнить сохранённые оценки",
    download: "Скачать оценки (.json)",
  },
};

for (const [lang, t] of Object.entries(labels))
  test(`${lang}: mobile estimates calculate, persist and export without sync`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    let writes = 0;
    await page.route("**/api/sync/**", (route) => {
      if (route.request().method() !== "GET") writes++;
      return route.fulfill({ json: { document: null } });
    });
    await page.goto(`/${lang}/planner/`);
    const section = page.getByRole("region", { name: t.title });
    const select = section.getByLabel(t.select);
    await select.selectOption("synthetic-fest:2027");
    await expect(section.getByLabel(t.fields[0], { exact: true })).toBeEmpty();
    for (const [index, value] of ["250", "100", "120", "35,00", "4"].entries()) {
      await section.getByLabel(t.fields[index], { exact: true }).fill(value);
    }
    await expect(section.locator("output")).toContainText("610");
    await section.getByRole("button", { name: t.save }).click();
    await expect(section.getByRole("heading", { name: t.compare })).toBeVisible();
    await expect(section.locator("li", { hasText: "Synthetic Fest 2027" })).toContainText("610");
    const href = await section.getByRole("link", { name: t.download }).getAttribute("href");
    const json = JSON.parse(decodeURIComponent(href.split(",")[1]));
    expect(json.tripBudgets["synthetic-fest:2027"].food).toBe(3500);
    await page.reload();
    await select.selectOption("synthetic-fest:2027");
    await expect(section.locator("output")).toContainText("610");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(writes).toBe(0);
  });

test("explicit sync restores an estimate on another device; sharing sends only a plan id", async ({
  page,
  context,
}) => {
  const key = "synthetic-fest:2027";
  const estimate = { currency: "EUR", people: 1, nights: 1, days: 1, ticket: 25000 };
  const documents = {};
  const writes = [];
  await page.addInitScript(
    ({ key, estimate }) => {
      localStorage.setItem(
        "festival-radar-planner-v1",
        JSON.stringify({ tripBudgets: { [key]: estimate } }),
      );
    },
    { key, estimate },
  );
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { user: { id: "fixture", email: "fixture@example.test" } },
    }),
  );
  await context.route("**/api/sync/**", async (route) => {
    const kind = new URL(route.request().url()).pathname.split("/").filter(Boolean).at(-1);
    if (route.request().method() === "PUT") {
      const { payload, revision } = route.request().postDataJSON();
      documents[kind] = {
        id: kind,
        payload,
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
      };
      writes.push(kind);
    }
    await route.fulfill({ json: { document: documents[kind] ?? null } });
  });
  await context.route("**/api/share", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ documentId: "plans", expiresAt: null });
    await route.fulfill({ status: 201, json: { share: { slug: "fixture-link" } } });
  });
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Create public plan link" }).click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  expect(writes).toEqual(["plans"]);
  expect(documents.plans.payload).toEqual({ attendance: {} });
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => documents.budgets?.payload).toEqual({ [key]: estimate });

  const other = await context.newPage();
  // The browser context shares origin storage; clear it before simulating a blank device.
  await other.goto("/en/planner/");
  await other.evaluate(() => localStorage.removeItem("festival-radar-planner-v1"));
  await other.reload();
  await other.getByRole("button", { name: "Use account data on this device" }).click();
  await expect(other.getByRole("region", { name: "Trip budgets" }).locator("li")).toContainText(
    "250",
  );
  expect(writes.filter((kind) => kind === "budgets")).toHaveLength(1);
});

test("accepting an unrelated remote revision never drops unsynced estimates", async ({ page }) => {
  const key = "synthetic-fest:2027";
  const estimate = { currency: "EUR", people: 1, nights: 1, days: 1, ticket: 72500 };
  const favoriteDoc = {
    id: "favorites",
    revision: 2,
    updatedAt: "2026-11-22T00:00:00.000Z",
    payload: { favoriteFestivals: ["synthetic-west"], favoriteArtists: [] },
  };
  let conflicting = false;
  await page.addInitScript(
    ({ key, estimate }) => {
      if (!localStorage.getItem("festival-radar-planner-v1"))
        localStorage.setItem(
          "festival-radar-planner-v1",
          JSON.stringify({ tripBudgets: { [key]: estimate } }),
        );
    },
    { key, estimate },
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: { id: "fixture", email: "fixture@example.test" } } }),
  );
  await page.route("**/api/sync/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      expect(request.url()).toMatch(/\/favorites$/);
      conflicting = true;
      return route.fulfill({ status: 409, json: { error: "conflict" } });
    }
    const favorite = request.url().endsWith("/favorites");
    await route.fulfill({ json: { document: favorite && conflicting ? favoriteDoc : null } });
  });
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await page.getByRole("button", { name: "Use other device" }).click();
  await expect(page.getByRole("region", { name: "Trip budgets" }).locator("li")).toContainText(
    "725",
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("festival-radar-planner-v1")),
  );
  expect(saved.favoriteFestivals).toEqual(["synthetic-west"]);
  expect(saved.tripBudgets).toEqual({ [key]: estimate });
});

test("undo refuses an over-limit merge, keeps the backup and can succeed after removal", async ({
  page,
}) => {
  const estimate = { currency: "EUR", people: 1, nights: 1, days: 1, ticket: 25000 };
  const archived = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`old-festival-${index}:2027`, estimate]),
  );
  await page.addInitScript((tripBudgets) => {
    if (!localStorage.getItem("festival-radar-planner-v1"))
      localStorage.setItem("festival-radar-planner-v1", JSON.stringify({ tripBudgets }));
  }, archived);
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Clear local data" }).click();
  await page.getByRole("button", { name: "Reset local plan", exact: true }).click();
  const budget = page.getByRole("region", { name: "Trip budgets" });
  await budget.getByLabel("Festival edition").selectOption("synthetic-fest:2027");
  await budget.getByLabel("Ticket per person", { exact: true }).fill("275");
  await budget.getByRole("button", { name: "Save estimate" }).click();
  const undo = page.getByRole("button", { name: "Undo local reset" });
  await undo.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Undo would exceed a plan limit" }),
  ).toBeVisible();
  const backup = await page
    .getByRole("link", { name: "Download plan backup (.json)" })
    .getAttribute("href");
  expect(JSON.parse(decodeURIComponent(backup.split(",")[1])).tripBudgets).toEqual(archived);
  await expect(budget.locator("li")).toContainText("275");

  await budget.getByRole("button", { name: "Remove estimate" }).click();
  await undo.click();
  await expect(budget.locator("li")).toHaveCount(100);
  await page.reload();
  await expect(budget.locator("li")).toHaveCount(100);
});

test("a saved non-EUR currency remains selected through the next edit", async ({ page }) => {
  await page.goto("/en/planner/");
  const budget = page.getByRole("region", { name: "Trip budgets" });
  await budget.getByLabel("Festival edition").selectOption("synthetic-fest:2027");
  const currency = budget.getByRole("combobox", { name: /^Currency/ });
  await currency.selectOption("GBP");
  await budget.getByLabel("Ticket per person", { exact: true }).fill("25");
  await budget.getByRole("button", { name: "Save estimate" }).click();
  await expect(currency).toHaveValue("GBP");
  await budget.getByLabel("Travel for the group", { exact: true }).fill("10");
  await budget.getByRole("button", { name: "Save estimate" }).click();
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("festival-radar-planner-v1")).tripBudgets[
        "synthetic-fest:2027"
      ],
  );
  expect(stored.currency).toBe("GBP");
  expect(stored.ticket + stored.travel).toBe(3500);
});

test("an estimate remains editable and removable after its edition leaves the current catalogue", async ({
  page,
}) => {
  const oldKey = "synthetic-fest:2026";
  await page.addInitScript((key) => {
    if (!localStorage.getItem("festival-radar-planner-v1"))
      localStorage.setItem(
        "festival-radar-planner-v1",
        JSON.stringify({
          tripBudgets: { [key]: { currency: "EUR", people: 1, nights: 1, days: 1, ticket: 25000 } },
        }),
      );
  }, oldKey);
  await page.goto("/en/planner/");
  const budget = page.getByRole("region", { name: "Trip budgets" });
  await budget.getByLabel("Festival edition").selectOption(oldKey);
  await expect(budget.getByLabel("Ticket per person", { exact: true })).toHaveValue("250.00");
  await budget.getByRole("button", { name: "Remove estimate" }).click();
  await expect(budget.getByRole("option", { name: oldKey })).toHaveCount(0);
  await page.reload();
  await expect(budget.getByRole("option", { name: oldKey })).toHaveCount(0);
});
