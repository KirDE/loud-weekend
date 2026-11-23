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
    name: "Synthetic Existing Festival Handoff",
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
  const edition = page.getByRole("link", { name: "synthetic-fest · 2027" });
  await expect(edition).toHaveAttribute("href", "/festivals/synthetic-fest/2027/");
  const unchanged = await page.request.get("/api/offline/catalog");
  expect(unchanged.status()).toBe(200);
  expect(await unchanged.json()).toEqual(await before.json());
});
