import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const copy = {
  en: {
    search: "Search festivals, artists or cities", clear: "Clear search",
    compare: name => `Compare ${name}`, remove: name => `Remove ${name} from comparison`,
    save: "☆ Save", saved: "★ Saved", attendance: "Attendance for Synthetic Fest",
    calendar: "Download calendar (.ics)",
  },
  de: {
    search: "Festivals, Künstler oder Städte durchsuchen", clear: "Suche löschen",
    compare: name => `${name} vergleichen`, remove: name => `${name} aus dem Vergleich entfernen`,
    save: "☆ Speichern", saved: "★ Gespeichert", attendance: "Teilnahme an Synthetic Fest",
    calendar: "Kalender herunterladen (.ics)",
  },
  ru: {
    search: "Поиск по фестивалям, артистам и городам", clear: "Очистить поиск",
    compare: name => `Сравнить ${name}`, remove: name => `Убрать ${name} из сравнения`,
    save: "☆ Сохранить", saved: "★ Сохранено", attendance: "Посещение фестиваля Synthetic Fest",
    calendar: "Скачать календарь (.ics)",
  },
};

for (const [lang, t] of Object.entries(copy)) {
  test(`${lang}: find, compare, save and export a festival without account sync`, async ({ page, baseURL }) => {
    const width = lang === "de" ? 390 : 320;
    await page.setViewportSize({ width, height: 780 });
    await page.context().addCookies([{ name: "festival-radar-language", value: lang, url: baseURL }]);
    const syncWrites = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/sync/") && request.method() !== "GET") {
        syncWrites.push(request.method());
      }
    });
    await page.goto(`/${lang}/`);
    const search = page.getByRole("textbox", { name: t.search });
    const grid = page.locator(".festivalGrid");
    await expect(search.locator("..")).toHaveAttribute("data-ready", "true");
    await search.fill("Second Artist");
    await expect(grid.getByRole("heading")).toHaveText(["Synthetic Fest"]);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("festival-radar-planner-v1") ?? "null")?.savedFilters?.query))
      .toBe("Second Artist");
    await page.reload();
    await expect(search).toHaveValue("Second Artist");
    await search.fill("Sample City");
    // The editorial suite may change Synthetic Fest's city earlier in the run.
    for (const name of ["Synthetic Alpine", "Synthetic West", "Synthetic South"]) {
      await expect(grid.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await search.fill("No such fixture city");
    await expect(grid.getByRole("heading")).toHaveCount(0);
    await page.getByRole("button", { name: t.clear, exact: true }).click();
    await expect(search).toBeFocused();

    const selected = ["Synthetic Fest", "Synthetic Alpine", "Synthetic West"];
    for (const festival of selected) {
      const button = grid.getByRole("button", { name: t.compare(festival), exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    const fourth = grid.getByRole("button", { name: t.compare("Synthetic South"), exact: true });
    await expect(fourth).toBeDisabled();
    const table = page.getByRole("table");
    for (const festival of selected) {
      await expect(table.getByRole("columnheader", { name: festival, exact: true })).toBeVisible();
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: t.remove("Synthetic West"), exact: true }).click();
    await expect(fourth).toBeEnabled();
    await table.getByRole("link", { name: "Synthetic Fest", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic Fest" })).toBeVisible();

    const attendance = page.getByRole("combobox", { name: t.attendance, exact: true });
    await page.getByRole("button", { name: t.save, exact: true }).click();
    await attendance.selectOption("going");
    const saved = page.getByRole("button", { name: t.saved, exact: true });
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(attendance).toHaveValue("going");

    await page.locator(".localActions").getByRole("link").click();
    const plan = page.locator(".planList");
    await expect(plan.getByRole("link", { name: "Synthetic Fest", exact: true })).toBeVisible();
    await expect(plan.getByRole("combobox")).toHaveValue("going");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: t.calendar, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("loud-weekend-2027.ics");
    const file = await readFile(await download.path(), "utf8");
    expect(file).toContain("BEGIN:VCALENDAR\r\n");
    expect(file).toContain("UID:synthetic-fest-2027@festival-radar\r\n");
    expect(file).toContain("DTSTART;VALUE=DATE:20270610\r\nDTEND;VALUE=DATE:20270613\r\n");
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(file.trimEnd()).toMatch(/END:VCALENDAR$/);
    expect(syncWrites).toEqual([]);
  });
}
