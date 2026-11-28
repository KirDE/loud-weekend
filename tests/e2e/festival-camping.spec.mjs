import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { readCampingFacts } from "../../lib/catalog/camping-facts.ts";
import { editionKey, readFreshnessEvidence } from "../../lib/catalog/freshness.ts";
import { readSitemapPublications } from "../../lib/catalog/sitemap-publications.ts";
import { collectCampingCandidate } from "../../lib/ingestion/camping-collector.ts";
import { campingSources, campingSourceUrl } from "../../lib/ingestion/adapters/camping-guidance.ts";
import {
  claimAgentIssue,
  listAgentIssues,
  releaseAgentIssue,
  resolveAgentIssue,
} from "../../lib/ingestion/agent-issues.ts";
import { stageOrganizerFixture } from "../support/arrival-fixture.mjs";
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
  return stageOrganizerFixture(db, { id: festivalId, slug: input.slug }, new Map([[url, html]]), {
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
              ...(record.slug === "wacken-open-air" && { endDate: new Date("2027-08-01") }),
              completeness: "TBA",
              sourceUpdatedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      inserted.push(festival.id);
    }

    await db.festivalEdition.create({
      data: {
        festivalId: inserted[0],
        year: year - 1,
        status: "CONFIRMED",
        ticketStatus: "UNKNOWN",
        recordState: "ARCHIVED",
        snapshotAt: new Date("2026-10-10T08:00:00Z"),
        completeness: "COMPLETE",
        sourceUpdatedAt: new Date(),
      },
    });
    const previews = [];
    for (const [index, input] of inputs.entries())
      previews.push(await stage(db, inserted[index], input));
    const wackenIndex = inputs.findIndex(({ slug }) => slug === "wacken-open-air");
    const wacken = inputs[wackenIndex];
    const afterFestival = wacken.html.replace("Monday, July 26", "Thursday, September 2");
    const late = await stage(db, inserted[wackenIndex], wacken, afterFestival);
    const lateClaim = await claimAgentIssue(db, late.sourceId, late.issueId);
    await expect(resolveAgentIssue(db, approve(lateClaim))).rejects.toThrow(
      /end of the reviewed edition/,
    );
    expect(await db.editionCampingFact.count()).toBe(0);
    await releaseAgentIssue(db, lateClaim.issueId, lateClaim.leaseToken);
    previews[wackenIndex] = await stage(db, inserted[wackenIndex], wacken);

    const campingRecords = previews.map((item) => item.candidate.camping);
    const first = campingRecords[0];
    const route = `/en/festivals/${first.festivalSlug}/`;
    const editionRoute = (slug, editionYear = year) => `/festivals/${slug}/${editionYear}/`;
    const before = await browser.newPage();
    try {
      expect(await db.editionCampingFact.count()).toBe(0);
      for (const path of [route, editionRoute(first.festivalSlug)]) {
        await before.goto(path);
        await expect(
          before.getByRole("region", { name: "Camping and on-site facilities" }),
        ).toHaveCount(0);
      }
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
          for (const path of [
            `/${lang}/festivals/${record.festivalSlug}/`,
            editionRoute(record.festivalSlug),
          ]) {
            await page.goto(path);
            await expect(page.locator("html")).toHaveAttribute("lang", lang);
            const panel = page.getByRole("region", { name: heading });
            await expect(panel.locator("dd")).toHaveCount(record.facts.length);
            await expect(panel.locator(`a[href="${record.sourceUrl}"]`)).toBeVisible();
            await expect(panel.locator(`time[datetime="${record.checkedOn}"]`)).toBeVisible();
            for (const fact of record.facts) {
              if (fact.field === "arrival") {
                await expect(panel.locator(`time[datetime="${fact.earliestDate}"]`)).toBeVisible();
              } else {
                await expect(
                  panel.getByText(fact.description[lang], { exact: true }),
                ).toBeVisible();
              }
            }
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(320);
          }
        }
        if (lang === "en") {
          await page.goto(editionRoute(first.festivalSlug, year - 1));
          await expect(page.getByRole("heading", { level: 1 })).toContainText(String(year - 1));
          await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
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

    const edition = {
      slug: wacken.slug,
      editionYear: year,
      city: wacken.city,
      countryCode: wacken.countryCode,
      officialUrl: `https://www.${wacken.organizerHost}/`,
    };
    const freshness = async () =>
      (await readFreshnessEvidence(db, new Date())).publishedByEdition.get(
        editionKey(wacken.slug, year),
      );
    const arrival = async () =>
      (await readCampingFacts(db, edition)).find(({ field }) => field === "arrival")?.earliestDate;
    const previousPublication = await freshness();
    expect(previousPublication).toBeDefined();
    expect(await arrival()).toBe("2027-07-26");

    const updatedHtml = wacken.html.replace("Monday, July 26", "Tuesday, July 27");
    const updateIssue = await stage(db, inserted[wackenIndex], wacken, updatedHtml);
    expect(await arrival()).toBe("2027-07-26");
    expect(await freshness()).toBe(previousPublication);
    const update = approve(await claimAgentIssue(db, updateIssue.sourceId, updateIssue.issueId));
    await expect(
      resolveAgentIssue(db, {
        ...update,
        decision: {
          ...update.decision,
          camping: previews[wackenIndex].candidate.campingFingerprint,
        },
      }),
    ).rejects.toThrow("invalid");
    expect(await arrival()).toBe("2027-07-26");
    expect(await freshness()).toBe(previousPublication);

    // Abort the real transaction after the importer has written the new facts and receipt.
    const rollback = new Error("Abort camping publication");
    const rollbackDb = {
      $transaction: (operation, options) =>
        db.$transaction(async (tx) => {
          const result = await operation(tx);
          expect(result.campingPublished).toBe(true);
          expect(result.publicationId).toBeTruthy();
          throw rollback;
        }, options),
    };
    await expect(resolveAgentIssue(rollbackDb, update)).rejects.toThrow(rollback);
    expect(await arrival()).toBe("2027-07-26");
    expect(await freshness()).toBe(previousPublication);

    const sitemapBefore = await readSitemapPublications(db, new Date());
    const updated = await resolveAgentIssue(db, update);
    expect(updated.campingPublished).toBe(true);
    expect(await arrival()).toBe("2027-07-27");
    const updatedPublication = await freshness();
    expect(updatedPublication > previousPublication).toBe(true);
    const sitemapAfter = await readSitemapPublications(db, new Date());
    const sitemapKey = editionKey(wacken.slug, year);
    const publication = await db.catalogPublication.findUniqueOrThrow({
      where: { id: updated.publicationId },
    });
    expect(publication.fields).toEqual(["camping"]);
    expect(sitemapAfter.get(sitemapKey)).toEqual({
      ...sitemapBefore.get(sitemapKey),
      festival: publication.createdAt.toISOString(),
      edition: publication.createdAt.toISOString(),
    });
    expect(sitemapAfter.get(sitemapKey).festival).not.toBe(sitemapBefore.get(sitemapKey).festival);
    expect(sitemapAfter.get(sitemapKey).edition).not.toBe(sitemapBefore.get(sitemapKey).edition);
    for (const [key, timestamp] of sitemapBefore) {
      if (key !== sitemapKey) expect(sitemapAfter.get(key)).toEqual(timestamp);
    }
    expect(await resolveAgentIssue(db, update)).toEqual(updated);

    expect(await freshness()).toBe(updatedPublication);
    expect(await readSitemapPublications(db, new Date())).toEqual(sitemapAfter);
  } finally {
    if (inserted.length) {
      await db.festivalSource.deleteMany({ where: { festivalId: { in: inserted } } });
      await db.festival.deleteMany({ where: { id: { in: inserted } } });
    }
    await db.$disconnect();
  }
});
