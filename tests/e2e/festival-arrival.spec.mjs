import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { stageArrivalFixture } from "../support/arrival-fixture.mjs";
import { arrivalSourceUrls } from "../../lib/ingestion/adapters/arrival-guidance.ts";
import {
  claimAgentIssue,
  inspectSource,
  releaseAgentIssue,
  resolveAgentIssue,
} from "../../lib/ingestion/agent-issues.ts";
import { prepareImportEvent, verifyDispatchEvent } from "../../lib/ingestion/import-events.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const headings = {
  en: "Venue and arrival",
  de: "Veranstaltungsort und Anreise",
  ru: "Место проведения и проезд",
};

test("arrival details come from reviewed rows for the exact edition and organizer", async ({
  browser,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const slug = "browser-arrival-fixture";
  const officialUrl = "https://www.arrival.example.test/";
  const review = {
    festivalSlug: slug,
    editionYear: 2030,
    countryCode: "DE",
    organizerHost: "arrival.example.test",
    facts: [
      {
        kind: "railShuttle",
        description: {
          en: "Coach from Central Station",
          de: "Bus ab Hauptbahnhof",
          ru: "Автобус от вокзала",
        },
        sourceUrl: officialUrl + "reviewed-travel/2030",
        supportingSourceUrl: "https://operator.example.test/2030",
        checkedOn: "2026-11-23",
      },
    ],
  };
  const [fact] = review.facts;
  const edition = {
    status: "TBA",
    ticketStatus: "UNKNOWN",
    completeness: "TBA",
    sourceUpdatedAt: new Date(),
  };
  let festivalId;
  try {
    const festival = await db.festival.create({
      data: {
        slug,
        name: "Arrival fixture",
        country: "Germany",
        countryCode: "DE",
        officialUrl,
        genres: [],
        catalogOrder: 9100,
        editions: {
          create: [
            { ...edition, year: 2030, recordState: "CURRENT" },
            { ...edition, year: 2029, recordState: "ARCHIVED" },
          ],
        },
      },
    });
    festivalId = festival.id;
    const editionRow = await db.festivalEdition.findUniqueOrThrow({
      where: { festivalId_year: { festivalId, year: 2030 } },
    });
    // This test isolates the generic public projection from organizer adapters.
    await db.editionArrivalFact.create({
      data: {
        editionId: editionRow.id,
        editionYear: review.editionYear,
        countryCode: review.countryCode,
        organizerHost: review.organizerHost,
        kind: fact.kind,
        descriptionEn: fact.description.en,
        descriptionDe: fact.description.de,
        descriptionRu: fact.description.ru,
        sourceUrl: fact.sourceUrl,
        supportingSourceUrl: fact.supportingSourceUrl,
        checkedOn: new Date(fact.checkedOn),
      },
    });

    for (const [locale, heading] of Object.entries(headings)) {
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      try {
        const page = await context.newPage();
        await page.goto(`/${locale}/festivals/${slug}/`);
        const panel = page.getByRole("region", { name: heading });
        await expect(panel.locator("dd")).toHaveCount(1);
        await expect(panel.getByText(fact.description[locale], { exact: false })).toBeVisible();
        await expect(panel.locator(`time[datetime="${fact.checkedOn}"]`)).toBeVisible();
        await expect(panel.locator(`a[href="${fact.sourceUrl}"]`)).toHaveAttribute(
          "rel",
          "noreferrer",
        );
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(320);
        await page.goto(`/festivals/${slug}/2030/`);
        await expect(panel.locator("dd")).toHaveCount(1);
        await page.goto(`/festivals/${slug}/2029/`);
        await expect(panel).toHaveCount(0);
      } finally {
        await context.close();
      }
    }

    const page = await browser.newPage();
    try {
      await page.goto(`/festivals/${slug}/`);
      await expect(page.getByRole("region", { name: headings.en })).toBeVisible();
      await db.festival.update({
        where: { id: festivalId },
        data: { officialUrl: "https://new.example.test/" },
      });
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Arrival fixture", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: headings.en })).toHaveCount(0);

      await db.festival.update({ where: { id: festivalId }, data: { officialUrl } });
      await db.festivalEdition.update({
        where: { festivalId_year: { festivalId, year: 2030 } },
        data: { year: 2032 },
      });
      await page.reload();
      await expect(page.getByRole("region", { name: headings.en })).toHaveCount(0);
    } finally {
      await page.close();
    }
  } finally {
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    await db.$disconnect();
  }
});

test("Graspop arrival comes from the reviewed organizer observation", async ({ page }) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const [essentials, announcement] = arrivalSourceUrls("graspop", 2027);
  const fixture = (name) =>
    readFile(new URL(`../fixtures/arrival/${name}.html`, import.meta.url), "utf8");
  const pages = new Map([
    [essentials, await fixture("graspop-essentials")],
    [announcement, await fixture("graspop-announcement")],
  ]);
  let festivalId;
  try {
    const item = await db.festival.create({
      data: {
        slug: "graspop",
        name: "Arrival source fixture",
        country: "Belgium",
        countryCode: "BE",
        officialUrl: "https://www.graspop.be/",
        genres: [],
        catalogOrder: 9100,
        editions: {
          create: {
            year: 2027,
            status: "TBA",
            ticketStatus: "UNKNOWN",
            recordState: "CURRENT",
            completeness: "TBA",
            sourceUpdatedAt: new Date(),
          },
        },
      },
    });
    festivalId = item.id;
    const staged = await stageArrivalFixture(db, item, pages);
    const oldClaim = await claimAgentIssue(db, staged.sourceId, staged.issueId);
    const approve = (claim) => ({
      sourceId: claim.sourceId,
      issueId: claim.issueId,
      snapshot: claim.snapshot,
      leaseToken: claim.leaseToken,
      decision: {
        action: "apply",
        reason: "Reviewed the exact organizer arrival evidence",
        arrival: claim.candidate.arrivalFingerprint,
      },
    });
    pages.set(
      announcement,
      pages.get(announcement).replace("Eindhoven Airport", "Antwerp Airport"),
    );
    const revised = await stageArrivalFixture(db, item, pages);
    expect(revised.issueId).not.toBe(staged.issueId);
    await expect(resolveAgentIssue(db, approve(oldClaim))).rejects.toThrow("stale");
    await releaseAgentIssue(db, oldClaim.issueId, oldClaim.leaseToken);

    const claim = await claimAgentIssue(db, revised.sourceId, revised.issueId);
    await expect(claimAgentIssue(db, revised.sourceId, revised.issueId)).rejects.toThrow("busy");
    const request = approve(claim);
    await expect(resolveAgentIssue(db, { ...request, leaseToken: randomUUID() })).rejects.toThrow(
      "busy",
    );
    await db.festivalSource.update({
      where: { id: revised.sourceId },
      data: { leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(resolveAgentIssue(db, request)).rejects.toThrow("busy");
    await db.festivalSource.update({
      where: { id: revised.sourceId },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
    await expect(
      resolveAgentIssue(db, {
        ...request,
        decision: { ...request.decision, arrival: "a".repeat(64) },
      }),
    ).rejects.toThrow("invalid");
    const retry = await resolveAgentIssue(db, {
      ...request,
      decision: { action: "retry", reason: "Defer pending another review window" },
    });
    expect(retry.status).toBe("retry");
    await expect(claimAgentIssue(db, revised.sourceId, revised.issueId)).rejects.toThrow("busy");
    expect(await db.editionArrivalFact.count({ where: { edition: { festivalId } } })).toBe(0);
    await db.operationalState.update({
      where: { key: revised.key },
      data: { payload: { status: "retry", retryAt: new Date(0).toISOString() } },
    });
    const fresh = await claimAgentIssue(db, revised.sourceId, revised.issueId);
    const approved = approve(fresh);
    const result = await resolveAgentIssue(db, approved);
    expect(result.arrivalPublished).toBe(true);
    expect(result.publicationId).toBeTruthy();
    expect(await resolveAgentIssue(db, approved)).toEqual(result);
    expect(
      await db.catalogPublication.count({
        where: { id: result.publicationId, fields: { equals: ["arrival"] } },
      }),
    ).toBe(1);
    const audit = await db.adminAuditEntry.findMany({
      where: {
        action: "ingestion.agent.apply",
        resourceKey: item.slug,
        metadata: { path: ["issueId"], equals: revised.issueId },
        beforeValue: { path: ["candidateId"], equals: fresh.candidate.id },
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: announcement, adapter: "arrival-guidance-v1" }),
      ]),
    );
    expect(
      await db.ingestionCandidate.findUnique({ where: { id: fresh.candidate.id } }),
    ).toMatchObject({ reviewState: "PUBLISHED", catalogueVersion: result.publicationId });
    const earlier = new Date();
    earlier.setUTCDate(earlier.getUTCDate() - 8);
    const arrivalScope = { edition: { festivalId } };
    await db.editionArrivalFact.updateMany({ where: arrivalScope, data: { checkedOn: earlier } });
    const observedAgain = await stageArrivalFixture(db, item, pages);
    expect(observedAgain.issueId).toBe(revised.issueId);
    const eventKey = "import-event-" + observedAgain.attempt.id + "-" + observedAgain.sourceId;
    const queued = await db.operationalState.findUniqueOrThrow({ where: { key: eventKey } });
    const until = new Date(result.retryAt);
    const before = new Date(until.getTime() - 1);
    expect(await prepareImportEvent(db, queued.payload, before)).toEqual({ defer: until });
    const dispatch = await prepareImportEvent(db, queued.payload, until);
    expect(dispatch.event).toMatchObject({
      kind: "source",
      sourceId: observedAgain.sourceId,
      issueId: observedAgain.issueId,
    });
    await db.operationalState.update({
      where: { key: revised.key },
      data: { payload: { ...result, retryAt: earlier.toISOString() } },
    });
    const due = await prepareImportEvent(db, queued.payload);
    expect(await verifyDispatchEvent(db, due.event)).toEqual({ ready: true, obsolete: false });
    const check = approve(await claimAgentIssue(db, observedAgain.sourceId, observedAgain.issueId));
    const freshness = await resolveAgentIssue(db, check);
    expect(freshness.publicationId).toBeNull();
    expect(freshness.arrivalPublished).toBe(false);
    expect(await resolveAgentIssue(db, check)).toEqual(freshness);
    expect(await verifyDispatchEvent(db, due.event)).toEqual({ ready: false, obsolete: true });
    const observationDay = observedAgain.candidate.arrival.facts[0].checkedOn;
    const refreshed = await db.editionArrivalFact.findMany({ where: arrivalScope });
    expect(refreshed.map(({ checkedOn }) => checkedOn.toISOString().slice(0, 10))).toEqual([
      observationDay,
      observationDay,
    ]);
    await db.festivalSource.update({
      where: { id: revised.sourceId },
      data: { consecutiveFailures: 1 },
    });
    const failed = await inspectSource(db, revised.sourceId);
    expect(failed?.kind).toBe("failure");
    const repair = {
      ...(await claimAgentIssue(db, revised.sourceId, failed.issueId)),
      decision: {
        action: "apply",
        reason: "Repair refresh policy for the registered organizer source",
        source: { url: essentials, strategies: ["manual_review"], refreshPolicy: "daily" },
        evidence: [
          {
            field: "source",
            url: essentials,
            checkedAt: new Date().toISOString(),
            contentHash: "a".repeat(64),
            excerpt: "Reviewed organizer guidance changes between weekly polls",
          },
        ],
      },
    };
    await expect(
      resolveAgentIssue(db, {
        ...repair,
        decision: {
          ...repair.decision,
          facts: { city: "Unsupported city" },
          evidence: [
            ...repair.decision.evidence,
            { ...repair.decision.evidence[0], field: "city" },
          ],
        },
      }),
    ).rejects.toThrow("invalid");
    const repaired = await resolveAgentIssue(db, repair);
    expect(repaired.publicationId).toBeNull();
    expect(await db.festivalSource.findUnique({ where: { id: revised.sourceId } })).toMatchObject({
      refreshPolicy: "daily",
      parserKey: "manual_review",
    });
    expect(await resolveAgentIssue(db, repair)).toEqual(repaired);
    await page.goto("/en/festivals/graspop/");
    const panel = page.getByRole("region", { name: headings.en });
    await expect(panel.locator("dd")).toHaveCount(2);
    await expect(panel.getByText(/Antwerp Airport/)).toBeVisible();
    await expect(panel.getByText(/Eindhoven Airport/)).toHaveCount(0);
    await expect(panel.locator(`time[datetime="${observationDay}"]`)).toHaveCount(2);
  } finally {
    if (festivalId) {
      await db.festivalSource.deleteMany({ where: { festivalId } });
      await db.festival.delete({ where: { id: festivalId } });
    }
    await db.$disconnect();
  }
});
