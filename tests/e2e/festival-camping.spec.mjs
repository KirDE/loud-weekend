import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectCampingCandidate } from "../../lib/ingestion/camping-collector.ts";
import { campingSources, campingSourceUrl } from "../../lib/ingestion/adapters/camping-guidance.ts";
import {
  claimAgentIssue,
  listAgentIssues,
  releaseAgentIssue,
  resolveAgentIssue,
} from "../../lib/ingestion/agent-issues.ts";
import { stageArrivalFixture } from "../support/arrival-fixture.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const year = 2027;
const inputs = await Promise.all(
  Object.keys(campingSources).map(async (slug) => ({
    slug,
    ...campingSources[slug],
    html: await readFile(new URL(`../fixtures/camping/${slug}.html`, import.meta.url), "utf8"),
  })),
);

function stage(db, festivalId, input, html = input.html) {
  const url = campingSourceUrl(input.slug, year);
  return stageArrivalFixture(db, { id: festivalId, slug: input.slug }, new Map([[url, html]]), {
    editionYear: year,
    collect: collectCampingCandidate,
    fingerprintField: "campingFingerprint",
  });
}

function approve({ sourceId, issueId, snapshot, leaseToken, candidate }) {
  return {
    sourceId,
    issueId,
    snapshot,
    leaseToken,
    decision: {
      action: "apply",
      reason: "Reviewed the organizer camping guidance",
      camping: candidate.campingFingerprint,
    },
  };
}

test("validated edition camping facts are accessible in every locale", async ({ browser }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const inserted = [];
  try {
    for (const record of inputs) {
      const festival = await db.festival.create({
        data: {
          slug: record.slug,
          name: `Edition fixture ${record.city}`,
          city: record.city,
          country: "Fixture country",
          countryCode: record.countryCode,
          officialUrl: `https://www.${record.organizerHost}/`,
          genres: [],
          catalogOrder: 9000,
          editions: {
            create: {
              year,
              status: "TBA",
              ticketStatus: "UNKNOWN",
              recordState: "CURRENT",
              completeness: "TBA",
              sourceUpdatedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      inserted.push(festival.id);
    }

    const previews = [];
    for (const [index, input] of inputs.entries())
      previews.push(await stage(db, inserted[index], input));
    const campingRecords = previews.map((item) => item.candidate.camping);
    const first = campingRecords[0];
    const route = `/en/festivals/${first.festivalSlug}/`;
    const before = await browser.newPage();
    try {
      expect(await db.editionCampingFact.count()).toBe(0);
      await before.goto(route);
      await expect(
        before.getByRole("heading", { name: "Camping and on-site facilities" }),
      ).toHaveCount(0);
    } finally {
      await before.close();
    }
    const firstIssue = previews[0];
    const obsolete = await claimAgentIssue(db, firstIssue.sourceId, firstIssue.issueId);
    const replacement = await stage(
      db,
      inserted[0],
      inputs[0],
      inputs[0].html + "<!-- replacement -->",
    );
    expect(replacement.issueId).toBe(firstIssue.issueId);
    await expect(resolveAgentIssue(db, approve(obsolete))).rejects.toThrow("stale");
    await releaseAgentIssue(db, obsolete.issueId, obsolete.leaseToken);
    previews[0] = replacement;

    for (const issue of previews) {
      const request = approve(await claimAgentIssue(db, issue.sourceId, issue.issueId));
      await expect(resolveAgentIssue(db, { ...request, leaseToken: randomUUID() })).rejects.toThrow(
        "busy",
      );
      await expect(
        resolveAgentIssue(db, {
          ...request,
          decision: { ...request.decision, camping: "0".repeat(64) },
        }),
      ).rejects.toThrow("invalid");
      const result = await resolveAgentIssue(db, request);
      expect(result.campingPublished).toBe(true);
      expect(result.providerJobs).toBe(0);
      expect(await resolveAgentIssue(db, request)).toEqual(result);
      const publication = await db.catalogPublication.findUniqueOrThrow({
        where: { id: result.publicationId },
      });
      expect(publication.fields).toEqual(["camping"]);
      expect(publication.evidence).toMatchObject({
        candidateId: issue.candidate.id,
        fingerprint: request.decision.camping,
        documents: [
          {
            url: issue.candidate.camping.sourceUrl,
            contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      });
      expect(
        await db.adminAuditEntry.count({
          where: {
            action: "ingestion.agent.apply",
            afterValue: { path: ["publicationId"], equals: result.publicationId },
          },
        }),
      ).toBe(1);
    }

    const changedHtml = inputs[0].html.replaceAll("Thursday 5", "Friday 6");
    const changedIssue = await stage(db, inserted[0], inputs[0], changedHtml);
    expect(changedIssue.issueId).not.toBe(firstIssue.issueId);
    const pending = await listAgentIssues(db);
    expect(pending.issues.some(({ issueId }) => issueId === changedIssue.issueId)).toBe(true);

    for (const [lang, heading] of Object.entries({
      en: "Camping and on-site facilities",
      de: "Camping und Ausstattung",
      ru: "Кемпинг и удобства",
    })) {
      const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
      try {
        const page = await context.newPage();
        for (const record of campingRecords) {
          await page.goto(`/${lang}/festivals/${record.festivalSlug}/`);
          const panel = page.getByRole("region", { name: heading });
          await expect(panel.locator("dd")).toHaveCount(record.facts.length);
          await expect(panel.locator(`a[href="${record.sourceUrl}"]`)).toBeVisible();
          await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
          for (const fact of record.facts) {
            if (fact.field === "arrival") {
              await expect(panel.locator(`time[datetime="${fact.earliestDate}"]`)).toBeVisible();
            } else {
              await expect(panel.getByText(fact.description[lang], { exact: true })).toBeVisible();
            }
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(320);
        }
        if (lang === "en") {
          await page.goto(`/festivals/${first.festivalSlug}/`);
          await expect(page.getByRole("region", { name: heading })).toBeVisible();
        }
        await page.goto(`/${lang}/festivals/synthetic-fest/`);
        await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        if (lang === "ru") {
          await db.festivalEdition.updateMany({
            where: { festivalId: inserted[0], year: first.editionYear },
            data: { year: first.editionYear + 1 },
          });
          await page.goto(`/${lang}/festivals/${first.festivalSlug}/`);
          await expect(
            page.getByRole("heading", { name: `Edition fixture ${first.city}`, exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    if (inserted.length) {
      await db.festivalSource.deleteMany({ where: { festivalId: { in: inserted } } });
      await db.festival.deleteMany({ where: { id: { in: inserted } } });
    }
    await db.$disconnect();
  }
});
