import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const targets = [
  { slug: "synthetic-west", data: { ticketStatus: "FREE", ticketsUrl: "https://festival.example.test/camping" } },
  { slug: "synthetic-south", data: { ticketStatus: "AVAILABLE", ticketsUrl: "https://festival.example.test/passes" } },
];
let restore = [];

test.beforeAll(async () => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  try {
    restore = await db.$transaction(async tx => {
      const previous = [];
      for (const { slug, data } of targets) {
        const { id, ticketStatus, ticketsUrl } = await tx.festivalEdition.findFirstOrThrow({
          where: { festival: { slug }, recordState: "CURRENT" },
          select: { id: true, ticketStatus: true, ticketsUrl: true },
        });
        await tx.festivalEdition.update({ where: { id }, data });
        previous.push({ id, ticketStatus, ticketsUrl });
      }
      return previous;
    });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  if (!restore.length) return;
  const db = createPrismaClient();
  try {
    await db.$transaction(restore.map(({ id, ...data }) => db.festivalEdition.update({ where: { id }, data })));
  } finally {
    await db.$disconnect();
  }
});

const copy = {
  en: ["Free admission — no ticket needed", "Official tickets ↗"],
  de: ["Eintritt frei — kein Ticket nötig", "Offizielle Tickets ↗"],
  ru: ["Вход свободный — билет не нужен", "Официальные билеты ↗"],
};
for (const [locale, [free, paid]] of Object.entries(copy)) {
  test(`comparison keeps free admission and paid tickets distinct (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(`/${locale}/`);
    await expect(page.locator(".search")).toHaveAttribute("data-ready", "true");
    for (const festival of ["Synthetic West", "Synthetic South"]) {
      const button = page.locator(".festivalCard").filter({ hasText: festival }).getByRole("button", { name: new RegExp(festival) });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    const comparison = page.getByRole("table");
    await expect(comparison.getByRole("link", { name: free })).toHaveAttribute("href", "https://festival.example.test/");
    await expect(comparison.getByRole("link", { name: paid })).toHaveAttribute("href", "https://festival.example.test/passes");
    await expect(comparison.locator('a[href$="/camping"]')).toHaveCount(0);
  });
}
