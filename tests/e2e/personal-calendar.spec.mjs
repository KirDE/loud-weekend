import { expect, test } from "@playwright/test";

const labels = {
  en: {
    title: "My calendar",
    conflicts: "Overlapping festival dates",
    export: "Download my calendar",
    all: "Festival calendar",
  },
  de: {
    title: "Mein Kalender",
    conflicts: "Überschneidende Festivaltermine",
    export: "Meinen Kalender herunterladen",
    all: "Festivalkalender",
  },
  ru: {
    title: "Мой календарь",
    conflicts: "Пересекающиеся даты фестивалей",
    export: "Скачать мой календарь",
    all: "Календарь фестивалей",
  },
};

for (const [lang, t] of Object.entries(labels)) {
  test(`selected festivals show conflicts and a separate, current ICS export (${lang})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            favoriteFestivals: ["synthetic-west"],
            attendance: {
              "synthetic-fest": "going",
              "synthetic-alpine": "maybe",
              "synthetic-south": "not-going",
            },
          }),
        );
    });
    await page.goto(`/${lang}/planner/`);
    const calendar = page.getByRole("region", { name: t.title, exact: true });
    const conflict = calendar.locator(".personalCalendarConflicts");
    await expect(conflict.getByRole("heading", { name: t.conflicts })).toBeVisible();
    await expect(conflict.locator("li")).toHaveCount(1);
    for (const [name, slug] of [
      ["Synthetic Fest", "synthetic-fest"],
      ["Synthetic Alpine", "synthetic-alpine"],
    ]) {
      const url = `/festivals/${slug}/2027/`;
      await expect(conflict.getByRole("link", { name, exact: true })).toHaveAttribute("href", url);
      await expect(calendar.locator("ol").getByRole("link", { name, exact: true })).toHaveAttribute(
        "href",
        url,
      );
    }
    await expect(page.getByRole("region", { name: t.all, exact: true })).toBeVisible();
    const exportLink = calendar.getByRole("link", { name: t.export });
    const data = () =>
      exportLink.getAttribute("href").then((href) => decodeURIComponent(href.split(",")[1]));
    const ics = await data();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTEND;VALUE=DATE:20270613");
    expect(ics).not.toContain("UID:synthetic-west-");
    const attendance = page
      .locator(".planList article")
      .filter({ hasText: "Synthetic Alpine" })
      .getByRole("combobox");
    await attendance.selectOption("not-going");
    await expect(conflict).toHaveCount(0);
    await expect.poll(data).not.toContain("UID:synthetic-alpine-");
    await page.reload();
    await expect(calendar).toBeVisible();
    await expect(conflict).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(375);
  });
}
