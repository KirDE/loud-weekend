import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const copy = {
  en: {
    title: "Group trips",
    create: "Create trip",
    name: "Trip name",
    editions: "Choose up to 12 editions",
    code: "Invitation code",
    join: "Join trip",
    invite: "Create invitation",
    role: "Invitation role",
    revoke: "Revoke",
    votes: "Votes",
    refresh: "Refresh trip",
    comments: "Comments",
    write: "Write a comment",
    add: "Post comment",
  },
  de: {
    title: "Gruppenreisen",
    create: "Reise erstellen",
    name: "Name der Reise",
    editions: "Bis zu 12 Ausgaben auswählen",
    code: "Einladungscode",
    join: "Reise beitreten",
    invite: "Einladung erstellen",
    role: "Berechtigung",
    revoke: "Widerrufen",
    votes: "Stimmen",
    refresh: "Reise aktualisieren",
    comments: "Kommentare",
    write: "Kommentar schreiben",
    add: "Kommentar senden",
  },
  ru: {
    title: "Групповые поездки",
    create: "Создать поездку",
    name: "Название поездки",
    editions: "Выберите не более 12 выпусков",
    code: "Код приглашения",
    join: "Присоединиться",
    invite: "Создать приглашение",
    role: "Роль приглашённого",
    revoke: "Отозвать",
    votes: "Голоса",
    refresh: "Обновить поездку",
    comments: "Комментарии",
    write: "Написать комментарий",
    add: "Отправить комментарий",
  },
};

test("mobile owner shares a private edition vote with an invited account and can revoke it", async ({
  browser,
  request,
  baseURL,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const prefix = `browser-group-${randomUUID()}`;
  const emails = [];
  const origin = new URL(baseURL).origin;
  async function session(language, role) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    if (role) {
      const email = `${prefix}-${language}-${role}@example.test`;
      emails.push(email);
      const secret = randomBytes(32).toString("base64url");
      await db.user.create({
        data: {
          email,
          sessions: {
            create: {
              tokenHash: createHash("sha256").update(secret).digest("hex"),
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
          },
          documents: {
            create: [
              { kind: "FAVORITES", payload: { favoriteArtists: ["fixture-private-artist"] } },
            ],
          },
        },
      });
      await context.addCookies([{ name: "festival_radar_session", value: secret, url: origin }]);
    }
    await context.addCookies([{ name: "festival-radar-language", value: language, url: origin }]);
    const page = await context.newPage();
    try {
      await page.goto("/group-trips/");
      return { context, page };
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  try {
    const anonymous = await request.get("/api/group-trips/");
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["cache-control"]).toBe("private, no-store");

    for (const [language, t] of Object.entries(copy)) {
      const owner = await session(language, "owner");
      const voter = await session(language, "voter");
      const viewer = await session(language, "viewer");
      try {
        await expect(owner.page.getByRole("heading", { name: t.title })).toBeVisible();
        const edition = owner.page.getByLabel(t.editions, { exact: true });
        const fixtureOption = edition.getByRole("option", { name: "Synthetic Fest 2027" });
        await expect(fixtureOption).toHaveCount(1);
        const editionId = await fixtureOption.getAttribute("value");
        await owner.page.getByLabel(t.name).fill("Browser fixture trip");
        await edition.selectOption(editionId);
        await owner.page.getByRole("button", { name: t.create }).click();
        const group = owner.page.getByRole("region", { name: "Browser fixture trip" });
        await expect(group).toBeVisible();
        const apiIndex = await owner.context.request.get("/api/group-trips/");
        const {
          trips: [{ id }],
        } = await apiIndex.json();
        expect((await voter.context.request.get(`/api/group-trips/?trip=${id}`)).status()).toBe(
          404,
        );
        const crossOrigin = await owner.context.request.post("/api/group-trips/", {
          headers: { Origin: "https://other.example.test" },
          data: { kind: "invite", tripId: id, role: "VOTER" },
        });
        expect(crossOrigin.status()).toBe(403);

        for (const [guest, role] of [
          [voter, "VOTER"],
          [viewer, "VIEWER"],
        ]) {
          await group.getByLabel(t.role, { exact: true }).selectOption(role);
          await group.getByRole("button", { name: t.invite }).click();
          const secret = group.getByLabel(t.code, { exact: true });
          await expect(secret).toHaveValue(/^[\w-]{43}$/);
          await guest.page.getByLabel(t.code, { exact: true }).fill(await secret.inputValue());
          await guest.page.getByRole("button", { name: t.join }).click();
          await expect(
            guest.page.getByRole("region", { name: "Browser fixture trip" }),
          ).toBeVisible();
        }

        const ballot = (page) =>
          page.getByRole("combobox", { name: `${t.votes}: Synthetic Fest 2027` });
        await expect(ballot(viewer.page)).toHaveCount(0);
        expect(
          (
            await viewer.context.request.post("/api/group-trips/", {
              headers: { Origin: origin },
              data: { kind: "vote", tripId: id, editionId, choice: "GOING" },
            })
          ).status(),
        ).toBe(404);
        await ballot(owner.page).focus();
        await ballot(voter.page).focus();
        await Promise.all([
          ballot(owner.page).selectOption("MAYBE"),
          ballot(voter.page).selectOption("GOING"),
        ]);
        await expect
          .poll(async () => {
            const response = await viewer.context.request.get(`/api/group-trips/?trip=${id}`);
            const visible = await response.json();
            expect(JSON.stringify(visible)).not.toContain("fixture-private-artist");
            expect(visible.invites).toBeUndefined();
            expect(visible.audit).toBeUndefined();
            return visible.options[0].tally;
          })
          .toEqual({ GOING: 1, MAYBE: 1 });
        await expect(ballot(owner.page)).toBeFocused();
        await expect(ballot(voter.page)).toBeFocused();
        for (const page of [owner.page, voter.page, viewer.page]) {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
        }

        const voteRegion = voter.page.getByRole("region", { name: "Browser fixture trip" });
        await voteRegion.getByText(`${t.comments} (0)`, { exact: true }).click();
        await voteRegion.getByLabel(t.write).fill("Synthetic private comment");
        await voteRegion.getByRole("button", { name: t.add }).click();
        await expect(
          voteRegion.getByText("Synthetic private comment", { exact: true }),
        ).toBeVisible();
        const viewRegion = viewer.page.getByRole("region", { name: "Browser fixture trip" });
        await viewRegion.getByRole("button", { name: t.refresh }).click();
        await viewRegion.getByText(`${t.comments} (1)`, { exact: true }).click();
        await expect(
          viewRegion.getByText("Synthetic private comment", { exact: true }),
        ).toBeVisible();
        await expect(viewRegion.getByLabel(t.write)).toHaveCount(0);
        await group.getByRole("button", { name: t.refresh }).click();
        const voterGrant = (
          await db.groupTripInvite.findFirstOrThrow({
            where: { tripId: id, role: "VOTER" },
            select: { id: true },
          })
        ).id;
        const grantOrder = (
          await (await owner.context.request.get(`/api/group-trips/?trip=${id}`)).json()
        ).invites;
        await group
          .getByRole("button", { name: t.revoke, exact: true })
          .nth(grantOrder.findIndex((invite) => invite.id === voterGrant))
          .click();
        await expect
          .poll(async () =>
            (await voter.context.request.get(`/api/group-trips/?trip=${id}`)).status(),
          )
          .toBe(404);
        await voter.page.getByRole("button", { name: t.refresh }).click();
        await expect(voter.page.getByRole("region", { name: "Browser fixture trip" })).toHaveCount(
          0,
        );
        await viewRegion.getByRole("button", { name: t.refresh }).click();
        await expect(
          viewRegion.getByText("Synthetic private comment", { exact: true }),
        ).toHaveCount(0);

        if (language === "en") {
          await group.getByText("Comments (0)", { exact: true }).click();
          await group.getByLabel(t.write).fill("Unsubmitted draft for the first trip");
          await owner.page.getByLabel(t.name).fill("Second fixture trip");
          await owner.page.getByRole("button", { name: t.create }).click();
          const second = owner.page.getByRole("region", { name: "Second fixture trip" });
          await second.getByText("Comments (0)", { exact: true }).click();
          await expect(second.getByLabel(t.write)).toHaveValue("");
        }
      } finally {
        await Promise.all([owner.context.close(), voter.context.close(), viewer.context.close()]);
      }
    }
  } finally {
    if (emails.length) await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  }
});
