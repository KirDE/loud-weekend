import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import {
  decideHellfestOffers,
  stageHellfestOffers,
} from "../../lib/ingestion/ticket-offer-proposal-store.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();

test.afterAll(async () => db.$disconnect());

test("only an approved full-pass price can be copied into a blank matching-currency estimate", async ({
  page,
}) => {
  const email = `budget-reference-${randomUUID()}@example.test`;
  const previousAllowlist = process.env.ADMIN_EMAILS;
  let festivalId;
  let actorId;
  try {
    const festival = await db.festival.create({
      data: {
        slug: "hellfest",
        name: "Synthetic budget reference festival",
        country: "France",
        countryCode: "FR",
        officialUrl: "https://hellfest.fr/",
        genres: [],
      },
    });
    festivalId = festival.id;
    const edition = await db.festivalEdition.create({
      data: {
        festivalId,
        year: 2027,
        status: "CONFIRMED",
        ticketStatus: "UNKNOWN",
        recordState: "CURRENT",
        completeness: "COMPLETE",
        sourceUpdatedAt: new Date(),
      },
    });
    const html = readFileSync(
      new URL("../fixtures/hellfest/offer-cards.html", import.meta.url),
      "utf8",
    )
      .replace("389€", "145,99€")
      .replace("home__ticket-card-soldout", "home__ticket-card-comingsoon")
      .replace(">complet<", ">à venir<");
    const row = await stageHellfestOffers(db, {
      editionId: edition.id,
      html,
      finalUrl: "https://hellfest.fr/",
      status: 200,
      observedAt: new Date().toISOString(),
    });
    const budget = page.getByRole("region", { name: "Trip budgets" });
    const choose = budget.getByLabel("Festival edition");
    const input = budget.getByLabel("Ticket per person", { exact: true });
    const copy = budget.getByRole("button", { name: "Use price in estimate" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/en/planner/");
    await choose.selectOption("hellfest:2027");
    await expect(copy).toHaveCount(0);
    await expect(input).toBeEmpty();

    process.env.ADMIN_EMAILS = email;
    actorId = (await db.user.create({ data: { email, role: "ADMIN" } })).id;
    await decideHellfestOffers(db, {
      snapshotId: row.id,
      expectedContentHash: row.contentHash,
      actorId,
      decision: "approve",
    });
    await page.reload();
    await choose.selectOption("hellfest:2027");
    await expect(input).toBeEmpty();
    await expect(budget.getByText("Published full-pass price:")).toContainText("145.99");
    await expect(
      budget.getByText("Fees unknown. This price does not confirm availability."),
    ).toBeVisible();
    await expect(budget.getByRole("link", { name: "Official source" })).toHaveAttribute(
      "href",
      "https://hellfest.fr/",
    );
    const currency = budget.getByRole("combobox", { name: /^Currency/ });
    await currency.selectOption("GBP");
    await expect(copy).toHaveCount(0);
    await currency.selectOption("EUR");
    await input.fill("123");
    await expect(copy).toHaveCount(0);
    await input.clear();
    await copy.click();
    await expect(input).toHaveValue("145.99");
    await expect(input).toBeFocused();
    await expect(budget.locator("output")).toContainText("145.99");
    await expect(budget.getByRole("heading", { name: "Compare saved estimates" })).toHaveCount(0);
    await budget.getByRole("button", { name: "Save estimate" }).click();
    await expect(budget.getByRole("heading", { name: "Compare saved estimates" })).toBeVisible();
    await page.reload();
    await choose.selectOption("hellfest:2027");
    await expect(input).toHaveValue("145.99");
    await expect(copy).toHaveCount(0);
    await choose.selectOption("synthetic-fest:2027");
    await expect(input).toBeEmpty();
    await expect(copy).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    if (previousAllowlist === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAllowlist;
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    if (actorId) await db.user.update({ where: { id: actorId }, data: { role: "USER" } });
  }
});
