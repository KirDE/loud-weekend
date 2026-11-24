import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
test.afterAll(() => db.$disconnect());

test("approved requests link exact known editions with a single actor audit and no publication", async ({
  page,
  baseURL,
}) => {
  const headers = { origin: baseURL };
  const input = {
    name: `Synthetic Existing Festival Handoff ${crypto.randomUUID()}`,
    year: 2027,
    officialUrl: "https://festival.example.test/edition/",
  };
  const submission = await page.request.post("/api/submissions/", { headers, data: input });
  expect([200, 201]).toContain(submission.status());
  const { reference } = await submission.json();
  const url = `/api/admin/submissions/${reference}/edition/`;
  const link = (slug = "synthetic-fest") => page.request.post(url, { headers, data: { slug } });
  expect((await link()).status()).toBe(403);

  const email = "browser-onboarding-editor@example.test";
  const password = "synthetic onboarding browser password";
  const passwordHash = await bcrypt.hash(password, 4);
  const editor = await db.user.upsert({
    where: { email },
    create: { email, passwordHash, role: "EDITOR" },
    update: { passwordHash, role: "EDITOR" },
  });
  expect(
    (await page.request.post("/api/auth/login/", { data: { email, password } })).status(),
  ).toBe(200);
  const stored = await db.festivalSubmission.findUniqueOrThrow({
    where: { publicReference: reference },
    include: { audit: true },
  });
  if (stored.status === "PENDING") {
    expect((await link()).status()).toBe(409);
    const approval = await page.request.post(`/api/admin/submissions/${reference}/`, {
      headers,
      data: { decision: "approve" },
    });
    expect(approval.status()).toBe(200);
    expect((await approval.json()).audit.some((record) => record.action === "EDITION_LINKED")).toBe(
      false,
    );
  }

  const before = await page.request.get("/api/offline/catalog");
  expect(before.status()).toBe(200);
  expect((await link("missing-edition")).status()).toBe(409);
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Festival submissions" }).click();
  const card = page.getByRole("article").filter({ hasText: input.name });
  await card.getByLabel("Existing edition").selectOption("synthetic-fest");
  await card.getByRole("button", { name: "Link existing edition" }).click();
  await expect(card.getByRole("link", { name: "synthetic-fest · 2027" })).toBeVisible();
  await page
    .getByRole("button", { name: "Festival submissions" })
    .locator("..")
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "Festival submissions" }).click();
  await expect(card.getByRole("link", { name: "synthetic-fest · 2027" })).toBeVisible();
  for (const response of await Promise.all([link(), link()])) expect(response.status()).toBe(200);
  expect((await link("synthetic-alpine")).status()).toBe(409);
  const audit = await db.festivalSubmissionAudit.findMany({
    where: { submissionId: stored.id, action: "EDITION_LINKED" },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actorId: editor.id,
    detail: { slug: "synthetic-fest", year: 2027 },
  });
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Festival submissions" }).click();
  const edition = card.getByRole("link", { name: "synthetic-fest · 2027" });
  await expect(edition).toHaveAttribute("href", "/festivals/synthetic-fest/2027/");
  const unchanged = await page.request.get("/api/offline/catalog");
  expect(unchanged.status()).toBe(200);
  expect(await unchanged.json()).toEqual(await before.json());
});

test("follow-on onboarding stages private proof then publishes exactly one tracked edition", async ({
  page,
  baseURL,
}) => {
  const headers = { origin: baseURL };
  const year = 2029;
  const slug = "synthetic-south";
  const landing = `/festivals/${slug}/${year}/`;
  const announcement = `https://festival.example.test/announcement-${year}/`;
  const register = async (name) => {
    const response = await page.request.post("/api/submissions/", {
      headers,
      data: {
        name: name + " " + randomUUID().slice(0, 8),
        year,
        officialUrl: announcement,
        notes: "Private submission note that must not become catalogue metadata",
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).reference;
  };
  const first = await register("Synthetic follow-on review");
  const duplicate = await register("Synthetic duplicate follow-on review");
  const url = (reference) => `/api/admin/submissions/${reference}/follow-on/`;
  const reviewed = {
    action: "stage",
    slug,
    evidenceUrl: announcement,
    excerpt: `Synthetic South ${year} announced by the organizer`,
  };
  const request = (reference, data) => page.request.post(url(reference), { headers, data });
  expect((await request(first, reviewed)).status()).toBe(403);

  const email = "browser-onboarding-editor@example.test";
  const password = "synthetic onboarding browser password";
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.upsert({
    where: { email },
    create: { email, passwordHash, role: "EDITOR" },
    update: { passwordHash, role: "EDITOR" },
  });
  expect(
    (await page.request.post("/api/auth/login/", { data: { email, password } })).status(),
  ).toBe(200);
  expect((await request(first, reviewed)).status()).toBe(409);
  for (const reference of [first, duplicate]) {
    expect(
      (
        await page.request.post(`/api/admin/submissions/${reference}/`, {
          headers,
          data: { decision: "approve" },
        })
      ).status(),
    ).toBe(200);
  }
  expect(
    (
      await request(first, { ...reviewed, evidenceUrl: "https://untrusted.example/announcement/" })
    ).status(),
  ).toBe(409);
  expect(
    (await request(first, { ...reviewed, excerpt: "Synthetic South 2028 announced" })).status(),
  ).toBe(409);
  expect(
    (await request(first, { ...reviewed, excerpt: "Another festival 2029 announced" })).status(),
  ).toBe(409);
  expect((await page.request.get(landing)).status()).toBe(404);

  const current = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug }, year: 2027 },
  });
  const priorSources = await db.festivalSource.count({ where: { festivalId: current.festivalId } });
  const priorJobs = await db.catalogPlaylistRefresh.count({ where: { festivalSlug: slug } });
  let editionId;
  try {
    const staged = await request(first, reviewed);
    expect(staged.status()).toBe(200);
    expect(staged.headers()["cache-control"]).toBe("private, no-store");
    const { draft } = await staged.json();
    expect((await (await request(first, reviewed)).json()).draft.id).toBe(draft.id);
    const second = await request(duplicate, reviewed);
    expect(second.status()).toBe(200);
    const otherDraft = (await second.json()).draft;
    expect((await request(first, { action: "publish", draftId: otherDraft.id })).status()).toBe(
      409,
    );
    expect((await page.request.get(landing)).status()).toBe(404);

    await page.goto("/admin/");
    await page.getByRole("button", { name: "Festival submissions" }).click();
    const card = page.locator("article.reviewCard").filter({ hasText: first });
    await expect(card.locator("blockquote")).toHaveText(reviewed.excerpt);
    const published = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === url(first),
    );
    const otherPublication = request(duplicate, { action: "publish", draftId: otherDraft.id });
    await card.getByRole("button", { name: "Publish the tracked edition" }).click();
    const responses = await Promise.all([published, otherPublication]);
    for (const response of responses) expect(response.status()).toBe(200);
    const link = (await responses[0].json()).link;
    editionId = link.editionId;
    expect((await responses[1].json()).link).toEqual(link);
    expect(
      (await (await request(first, { action: "publish", draftId: draft.id })).json()).link,
    ).toEqual(link);

    const edition = await db.festivalEdition.findUniqueOrThrow({
      where: { id: editionId },
      include: { provenance: true, lineup: true },
    });
    expect(edition).toMatchObject({
      year,
      recordState: "TRACKING",
      ticketStatus: "UNKNOWN",
      startDate: null,
      endDate: null,
      lineup: [],
    });
    expect(edition.provenance).toHaveLength(1);
    expect(edition.provenance[0]).toMatchObject({ field: "edition", url: announcement });
    expect(await db.festivalEdition.findUnique({ where: { id: current.id } })).toEqual(current);
    expect(await db.festivalSource.count({ where: { festivalId: current.festivalId } })).toBe(
      priorSources,
    );
    expect(await db.catalogPlaylistRefresh.count({ where: { festivalSlug: slug } })).toBe(
      priorJobs,
    );
    await expect(card.getByRole("link", { name: `${slug} · ${year}` })).toHaveAttribute(
      "href",
      landing,
    );
    await page.goto(landing);
    await expect(page.getByRole("heading", { name: `Synthetic South ${year}` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Official source ↗" })).toHaveAttribute(
      "href",
      announcement,
    );
    await expect(page.getByText(reviewed.excerpt, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Private submission note", { exact: false })).toHaveCount(0);
  } finally {
    if (editionId) await db.festivalEdition.delete({ where: { id: editionId } });
  }
});
