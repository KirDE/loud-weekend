import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { collectReviewedVenue } from "../../lib/ingestion/venue-collector.ts";
import { brutalAssaultVenueSource } from "../../lib/ingestion/adapters/brutal-assault-venue.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

const html = await readFile(
  new URL("../fixtures/brutal-assault/about-venue.html", import.meta.url),
  "utf8",
);
const { festivalSlug, sourceUrl, countryCode } = brutalAssaultVenueSource;
const edition = 2027;
const actor = "venue-review-fixture";
const response = (body) => async (url, init) => {
  expect(url).toBe(sourceUrl);
  expect(init.redirect).toBe("error");
  const page = new Response(body, { headers: { "content-type": "text/html" } });
  Object.defineProperty(page, "url", { value: sourceUrl });
  return page;
};
const labels = {
  en: "Organizer-confirmed venue",
  de: "Vom Veranstalter bestätigter Ort",
  ru: "Место подтверждено организатором",
};

test("the public map shows only persisted venue evidence for the selected edition", async ({
  browser,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  let festivalId;
  try {
    const festival = await db.festival.create({
      data: {
        slug: festivalSlug,
        name: "Venue fixture",
        officialUrl: sourceUrl,
        city: "Jaroměř",
        countryCode,
        country: "Czechia",
        latitude: 50,
        longitude: 15,
        genres: [],
        catalogOrder: 9000,
        editions: {
          create: {
            year: edition,
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
    festivalId = festival.id;

    const venueInMapList = async (page, lang) => {
      await page.goto(`/${lang}/planner/`);
      const list = page.locator(".mapTextList");
      await list.locator("summary").click();
      return list
        .locator("li")
        .filter({ has: page.getByRole("link", { name: /^Venue fixture/ }) })
        .last();
    };

    const preview = await collectReviewedVenue(db, edition, { fetchImpl: response(html) });
    expect(preview).toMatchObject({
      name: "Josefov Fortress",
      editionYear: edition,
      sourceUrl,
      checkOnly: true,
    });
    expect(await db.editionVenue.count()).toBe(0);
    const staged = await db.ingestionCandidate.findUniqueOrThrow({
      where: { id: preview.candidateId },
      include: { evidence: true },
    });
    expect(staged.reviewState).toBe("PENDING");
    expect(staged.evidence).toEqual([
      expect.objectContaining({ sourceUrl, contentHash: preview.fingerprint }),
    ]);
    const before = await browser.newPage({ viewport: { width: 320, height: 844 } });
    try {
      await expect(await venueInMapList(before, "en")).toContainText("Approximate location");
    } finally {
      await before.close();
    }
    const collect = (body, approval = preview.token) =>
      collectReviewedVenue(db, edition, { fetchImpl: response(body), approval, actor });
    await expect(collect(html.replace("25.54", "26.54"))).rejects.toThrow(/changed since preview/);
    await expect(collect(html.replace("GPS location", "Approximate map centre"))).rejects.toThrow(
      /No unambiguous/,
    );
    await expect(collect(html.replace("2027", "2026"))).rejects.toThrow(/No unambiguous/);
    const wrongPlace = html.replace("Jaroměř", "Wrong city");
    await expect(
      collectReviewedVenue(db, edition, { fetchImpl: response(wrongPlace) }),
    ).rejects.toThrow(/exact catalogue edition/);
    expect(await db.editionVenue.count()).toBe(0);
    const changedHtml = html.replace("25.54", "26.54");
    const refreshed = await collectReviewedVenue(db, edition, { fetchImpl: response(changedHtml) });
    await collect(changedHtml, refreshed.token);
    await collect(changedHtml, refreshed.token);
    await expect(collect(html)).rejects.toThrow(/superseded/);
    expect(
      await db.catalogPublication.count({
        where: { sourceId: `ingestion:${refreshed.candidateId}` },
      }),
    ).toBe(1);
    const applied = await db.ingestionCandidate.findUniqueOrThrow({
      where: { id: refreshed.candidateId },
    });
    expect(applied).toMatchObject({ reviewState: "PUBLISHED", reviewActor: actor });
    expect(
      await db.catalogPublication.findUniqueOrThrow({
        where: { id: applied.catalogueVersion },
      }),
    ).toMatchObject({
      fields: ["venue"],
      evidence: expect.objectContaining({ fingerprint: refreshed.fingerprint }),
    });
    expect(
      await db.ingestionCandidate.findUniqueOrThrow({
        where: { id: preview.candidateId },
        include: { evidence: true },
      }),
    ).toEqual(staged);
    expect(await db.editionVenue.findFirst()).toMatchObject({
      latitude: refreshed.latitude,
      name: refreshed.name,
      sourceUrl,
    });
    expect(refreshed.latitude).toBeGreaterThan(preview.latitude);

    const previousCheck = new Date("2024-01-01");
    await db.editionVenue.updateMany({
      where: { edition: { festivalId } },
      data: { checkedOn: previousCheck },
    });
    const identical = await collectReviewedVenue(db, edition, { fetchImpl: response(changedHtml) });
    await collect(changedHtml, identical.token);
    await collect(changedHtml, identical.token);
    const rechecked = await db.ingestionCandidate.findUniqueOrThrow({
      where: { id: identical.candidateId },
      include: { evidence: true },
    });
    expect(
      await db.catalogPublication.findMany({
        where: { festivalSlug, editionYear: edition, fields: { has: "venue" } },
        select: { id: true },
      }),
    ).toEqual([{ id: applied.catalogueVersion }]);
    expect(rechecked).toMatchObject({
      reviewState: "APPROVED",
      reviewActor: actor,
      reviewedAt: expect.any(Date),
      publishedAt: null,
      catalogueVersion: null,
    });
    expect(rechecked.evidence).toHaveLength(1);
    const checkedOn = await db.editionVenue.findFirstOrThrow({
      where: { edition: { festivalId } },
    });
    expect(checkedOn.checkedOn.toISOString().slice(0, 10)).toBe(identical.checkedOn);

    for (const [lang, confirmed] of Object.entries(labels)) {
      const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
      try {
        const location = await venueInMapList(page, lang);
        await expect(location).toContainText(`${preview.name} · ${confirmed}`);
      } finally {
        await page.close();
      }
    }
    await db.festivalEdition.updateMany({ where: { festivalId }, data: { year: edition + 1 } });
    const changed = await browser.newPage({ viewport: { width: 320, height: 844 } });
    try {
      const location = await venueInMapList(changed, "en");
      await expect(location).toContainText("Approximate location");
      await expect(location).not.toContainText(preview.name);
    } finally {
      await changed.close();
    }
  } finally {
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    await db.$disconnect();
  }
});
