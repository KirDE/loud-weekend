import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectOverviewCandidate } from "../../lib/ingestion/overview-collector.ts";
import { overviewOrganizer } from "../../lib/ingestion/adapters/festival-overview.ts";
import {
  claimAgentIssue,
  releaseAgentIssue,
  resolveAgentIssue,
} from "../../lib/ingestion/agent-issues.ts";
import { stageOrganizerFixture } from "../support/arrival-fixture.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const slug = "hellfest";
const year = 2027;
const source = overviewOrganizer(slug, year);
const detailPath = (language) => `/${language}/festivals/${slug}/`;

function fixture(stageCount, edition = year) {
  const evidence =
    stageCount === undefined
      ? ""
      : `<h4>Expanding from 2 to ${stageCount} stages and featuring over 42 bands</h4>`;
  return new Map([
    [
      source.url,
      `<div class="article"><h1>HELLFEST ${edition} - FIRST INSIGHTS</h1>
      <div class="ck-content">${evidence}</div></div>`,
    ],
  ]);
}

const stage = (count) =>
  stageOrganizerFixture(db, { id: festivalId, slug }, fixture(count), {
    editionYear: year,
    collect: collectOverviewCandidate,
    fingerprintField: "overviewFingerprint",
  });
const approve = ({ sourceId, issueId, snapshot, leaseToken, candidate }) => ({
  sourceId,
  issueId,
  snapshot,
  leaseToken,
  decision: {
    action: "apply",
    reason: "Reviewed the exact organizer overview evidence",
    overview: candidate.overviewFingerprint,
  },
});

let festivalId;
test.beforeAll(async () => {
  const festival = await db.festival.create({
    data: {
      slug,
      name: "Fixture Festival",
      country: "France",
      countryCode: source.countryCode,
      city: source.city,
      genres: [],
      officialUrl: new URL(source.url).origin,
      catalogOrder: 9000,
      editions: {
        create: {
          year,
          status: "TBA",
          ticketStatus: "UNKNOWN",
          recordState: "CURRENT",
          completeness: "TBA",
          sourceUpdatedAt: new Date("2026-10-01T00:00:00Z"),
        },
      },
    },
  });
  festivalId = festival.id;
});
test.afterAll(async () => {
  if (festivalId) {
    await db.festivalSource.deleteMany({ where: { festivalId } });
    await db.festival.delete({ where: { id: festivalId } });
  }
  await db.$disconnect();
});

test("only the current imported overview can be approved and replayed", async ({ page }) => {
  const region = page.getByRole("region", { name: "About this festival" });
  const staged = await stage(7);
  const obsolete = await claimAgentIssue(db, staged.sourceId, staged.issueId);
  await page.goto(detailPath("en"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixture Festival");
  await expect(region).toHaveCount(0);

  const next = await stage(8);
  await expect(resolveAgentIssue(db, approve(obsolete))).rejects.toThrow("stale");
  await releaseAgentIssue(db, obsolete.issueId, obsolete.leaseToken);
  const claim = await claimAgentIssue(db, next.sourceId, next.issueId);
  const request = approve(claim);
  await expect(resolveAgentIssue(db, { ...request, leaseToken: randomUUID() })).rejects.toThrow(
    "busy",
  );
  await expect(
    resolveAgentIssue(db, {
      ...request,
      decision: { ...request.decision, overview: "a".repeat(64) },
    }),
  ).rejects.toThrow("invalid");
  expect(await db.editionOverview.count({ where: { edition: { festivalId } } })).toBe(0);

  const receipt = await resolveAgentIssue(db, request);
  expect(receipt.overviewPublished).toBe(true);
  expect(receipt.providerJobs).toBe(0);
  expect(await resolveAgentIssue(db, request)).toEqual(receipt);
  const publication = await db.catalogPublication.findUniqueOrThrow({
    where: { id: receipt.publicationId },
  });
  expect(publication.fields).toEqual(["overview"]);
  expect(publication.evidence).toMatchObject({
    candidateId: next.candidate.id,
    fingerprint: request.decision.overview,
    documents: [{ url: source.url, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }],
  });
  const audit = await db.adminAuditEntry.findMany({
    where: {
      action: "ingestion.agent.apply",
      resourceKey: slug,
      afterValue: { path: ["publicationId"], equals: receipt.publicationId },
    },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0].afterValue.overview).toEqual(next.candidate.overview);

  await page.reload();
  await expect(region.getByText(next.candidate.overview.summary.en)).toBeVisible();
  const staleCity = await stage(9);
  const boundToCity = await claimAgentIssue(db, staleCity.sourceId, staleCity.issueId);
  await db.festival.update({ where: { id: festivalId }, data: { city: null } });
  try {
    await page.reload();
    await expect(region).toHaveCount(0);
    await expect(resolveAgentIssue(db, approve(boundToCity))).rejects.toThrow("stale");
  } finally {
    await db.festival.update({ where: { id: festivalId }, data: { city: source.city } });
    await releaseAgentIssue(db, boundToCity.issueId, boundToCity.leaseToken);
  }
});

for (const [lang, heading] of Object.entries({
  en: "About this festival",
  de: "Über dieses Festival",
  ru: "О фестивале",
})) {
  test(`${lang} shows the localized reviewed observation and provenance`, async ({ page }) => {
    const count = { en: 10, de: 11, ru: 12 }[lang];
    const issue = await stage(count);
    const record = issue.candidate.overview;
    await resolveAgentIssue(db, approve(await claimAgentIssue(db, issue.sourceId, issue.issueId)));
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto(detailPath(lang));
    const region = page.getByRole("region", { name: heading });
    await expect(region.getByText(record.summary[lang], { exact: true })).toBeVisible();
    await expect(region.locator(`a[href="${source.url}"]`)).toBeVisible();
    await expect(region.locator("time")).toHaveAttribute("datetime", record.checkedOn);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.goto(`/${lang}/festivals/synthetic-fest/`);
    await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
  });
}
