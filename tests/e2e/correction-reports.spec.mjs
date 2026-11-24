import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const note = "Synthetic correction workflow fixture";
const email = "browser-corrections-editor@example.test";
const password = "synthetic correction browser password";

async function signInAsEditor(page) {
  const passwordHash = await bcrypt.hash(password, 4);
  const editor = await db.user.upsert({
    where: { email },
    create: { email, passwordHash, role: "EDITOR" },
    update: { passwordHash, role: "EDITOR" },
  });
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(
    200,
  );
  return editor;
}
test.afterAll(async () => {
  await db.correctionReport.deleteMany({ where: { notes: { startsWith: note } } });
  await db.$disconnect();
});

const labels = {
  en: [
    "Report a correction",
    "Official HTTPS source",
    "Send report",
    "Report received for editorial review",
  ],
  de: [
    "Korrektur melden",
    "Offizielle HTTPS-Quelle",
    "Meldung senden",
    "Die Redaktion prüft die Meldung",
  ],
  ru: [
    "Сообщить об ошибке",
    "Официальный источник (HTTPS)",
    "Отправить сообщение",
    "Сообщение передано редакции",
  ],
};

for (const [lang, [report, source, send, received]] of Object.entries(labels)) {
  test(`localized festival and artist correction forms at 320px (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ["festivals/synthetic-fest", "artists/sample-artist"]) {
      await page.goto(`/${lang}/${path}/`);
      const form = page.locator(".correctionReport");
      await form.getByText(report, { exact: true }).click();
      await form.getByLabel(source).fill("https://festival.example.test/lineup");
      await form.locator("textarea").fill(`${note} ${path}`);
      await form.getByRole("button", { name: send }).click();
      await expect(form.getByRole("status")).toContainText(received);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    }
    expect(
      await db.correctionReport.count({
        where: { notes: { startsWith: note }, status: "PENDING" },
      }),
    ).toBe(2);
  });
}

test("throttled and invalid reports do not publish; an authorized decision is auditable and one-shot", async ({
  page,
  baseURL,
}) => {
  const headers = { origin: baseURL, "x-real-ip": "192.0.2.24" };
  const data = {
    target: "edition",
    slug: "synthetic-fest",
    year: 2027,
    kind: "DATE",
    sourceUrl: "https://festival.example.test/news",
    notes: `${note} decision`,
    website: "",
  };
  const send = (patch = {}, customHeaders = headers) =>
    page.request.post("/api/corrections", { headers: customHeaders, data: { ...data, ...patch } });
  expect((await send({}, { origin: "https://untrusted.example.test" })).status()).toBe(403);
  expect((await send({ website: "spam" })).status()).toBe(422);
  expect((await send({ sourceUrl: "https://untrusted.example.test/" })).status()).toBe(422);
  expect((await send({ year: 2199 })).status()).toBe(404);
  const initial = await page.request.get("/api/offline/catalog");
  for (const response of await Promise.all([send(), send()])) expect(response.status()).toBe(202);
  const reports = await db.correctionReport.findMany({ where: { notes: data.notes } });
  expect(reports).toHaveLength(1);
  for (let index = 0; index < 4; index++)
    expect((await send({ notes: `${note} limit ${index}` })).status()).toBe(202);
  expect((await send({ notes: `${note} over limit` })).status()).toBe(429);

  const report = reports[0];
  const decide = () =>
    page.request.post(`/api/admin/corrections/${report.id}`, {
      headers,
      data: { status: "ACCEPTED" },
    });
  expect((await decide()).status()).toBe(403);
  const reviewer = await signInAsEditor(page);
  await page.goto("/admin/");
  await page.getByRole("link", { name: "Correction reports" }).click();
  const card = page.locator("article").filter({ hasText: data.notes });
  await card.getByRole("button", { name: "Accept for follow-up" }).click();
  await expect(card).toContainText("Accepted");
  await page.reload();
  await expect(card).toContainText("Accepted");
  expect((await decide()).status()).toBe(409);
  expect(await db.correctionReport.findUnique({ where: { id: report.id } })).toMatchObject({
    status: "ACCEPTED",
    editionYear: 2027,
    reviewerId: reviewer.id,
    reviewedAt: expect.any(Date),
  });
  expect(await db.festivalEdition.findUnique({ where: { id: report.editionId } })).toMatchObject({
    startDate: new Date("2027-06-10"),
  });
  expect(initial.status()).toBe(200);
  const final = await page.request.get("/api/offline/catalog");
  expect(final.status()).toBe(200);
  expect(await final.json()).toEqual(await initial.json());
});

test("review history reaches older dismissed reports after newer accepted reports", async ({
  page,
}) => {
  const editor = await signInAsEditor(page);
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug: "synthetic-fest" }, year: 2027 },
  });
  const base = {
    targetName: "Synthetic Fest",
    editionId: edition.id,
    editionYear: edition.year,
    kind: "DATE",
    sourceUrl: "https://festival.example.test/",
    fingerprint: "synthetic-fixture",
    reporterHash: "synthetic-fixture",
    submittedAt: new Date("2026-02-01T00:00:00Z"),
    reviewedAt: new Date("2026-02-02T00:00:00Z"),
    reviewerId: editor.id,
  };
  const older = `${note} older dismissed item`;
  await db.correctionReport.createMany({
    data: [
      {
        ...base,
        notes: older,
        status: "DISMISSED",
        reviewerId: editor.id,
        submittedAt: new Date("2026-01-01T00:00:00Z"),
        reviewedAt: new Date("2026-01-02T00:00:00Z"),
      },
      ...Array.from({ length: 25 }, (_, index) => ({
        ...base,
        notes: `${note} recent accepted item ${index}`,
        status: "ACCEPTED",
      })),
    ],
  });
  await page.goto("/admin/corrections/");
  await page.getByRole("link", { name: "Review history" }).click();
  await expect(page.getByText(older)).toHaveCount(0);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText(older)).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
});

test("correction intake accepts an artist with a cancelled appearance and no public profile", async ({
  page,
  baseURL,
}) => {
  const artist = await db.artist.findUniqueOrThrow({ where: { slug: "second-artist" } });
  const appearance = await db.lineupEntry.findFirstOrThrow({ where: { artistId: artist.id } });
  await db.lineupEntry.update({ where: { id: appearance.id }, data: { status: "CANCELLED" } });
  try {
    expect((await page.request.get("/en/artists/second-artist/")).status()).toBe(404);
    const response = await page.request.post("/api/corrections", {
      headers: { origin: baseURL, "x-real-ip": "192.0.2.25" },
      data: {
        target: "artist",
        slug: artist.slug,
        kind: "IDENTITY",
        website: "",
        sourceUrl: "https://festival.example.test/lineup",
        notes: `${note} cancelled`,
      },
    });
    expect(response.status()).toBe(202);
    expect(
      await db.correctionReport.findFirst({ where: { notes: `${note} cancelled` } }),
    ).toMatchObject({ artistId: artist.id });
  } finally {
    await db.lineupEntry.update({
      where: { id: appearance.id },
      data: { status: appearance.status },
    });
  }
});
