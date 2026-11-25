import { randomUUID } from "node:crypto";
import { publishAgentFestivalResolution } from "../../lib/catalog/publication.ts";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../lib/prisma-client.mjs";

test("public festival and artist URLs advertise distinct localized, cacheable preview images", async ({
  request,
}) => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
    !/(?:test|integration)/i.test(databaseUrl.pathname)
  ) {
    throw new Error("A loopback disposable DATABASE_URL is required");
  }
  const db = createPrismaClient();
  const festivalPath = "/api/social/de/festivals/synthetic-fest/2027/";
  const artistPath = "/api/social/ru/artists/sample-artist/";
  let fixtureFestival;
  try {
    for (const [path, imagePath, alt] of [
      ["/de/festivals/synthetic-fest/", festivalPath, "Festival: Synthetic Fest · 2027"],
      ["/ru/artists/sample-artist/", artistPath, "Артист: Sample Artist"],
    ]) {
      const page = await request.get(path, { headers: { "user-agent": "Twitterbot/1.0" } });
      expect(page.status()).toBe(200);
      const html = await page.text();
      expect(html).toContain(`property="og:url" content="https://loudweekend.eu${path}"`);
      expect(html).toContain(`property="og:image" content="https://loudweekend.eu${imagePath}"`);
      expect(html).toContain('property="og:image:width" content="1200"');
      expect(html).toContain('property="og:image:height" content="630"');
      expect(html).toContain(`property="og:image:alt" content="${alt}"`);
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain(`name="twitter:image" content="https://loudweekend.eu${imagePath}"`);
    }

    const [festival, artist, english] = await Promise.all([
      request.get(festivalPath),
      request.get(artistPath),
      request.get(festivalPath.replace("/de/", "/en/")),
    ]);
    for (const response of [festival, artist, english]) {
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      const { width, height } = await sharp(await response.body()).metadata();
      expect([width, height]).toEqual([1200, 630]);
    }
    expect(await festival.body()).not.toEqual(await artist.body());
    expect(await festival.body()).not.toEqual(await english.body());

    const cancelled = await db.lineupEntry.findMany({
      where: {
        artist: { slug: "sample-artist" },
        edition: { recordState: "CURRENT" },
        status: "ANNOUNCED",
      },
      select: { id: true },
    });
    expect(cancelled.length).toBeGreaterThan(0);
    const entries = { id: { in: cancelled.map(({ id }) => id) } };
    await db.lineupEntry.updateMany({ where: entries, data: { status: "CANCELLED" } });
    try {
      const response = await request.get(artistPath);
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toContain("no-store");
    } finally {
      await db.lineupEntry.updateMany({ where: entries, data: { status: "ANNOUNCED" } });
    }

    const tag = festival.headers().etag;
    expect(tag).toBeTruthy();
    expect(festival.headers()["cache-control"]).toContain("public, max-age=300");
    expect((await request.get(festivalPath, { headers: { "if-none-match": tag } })).status()).toBe(
      304,
    );

    const slug = `social-preview-${randomUUID()}`;
    fixtureFestival = await db.festival.create({
      data: {
        slug,
        name: "Preview date fixture",
        country: "Testland",
        countryCode: "DE",
        officialUrl: "https://festival.example.test/",
        genres: [],
        editions: {
          create: {
            year: 2027,
            status: "TBA",
            ticketStatus: "UNKNOWN",
            recordState: "CURRENT",
            completeness: "PARTIAL",
            sourceUpdatedAt: new Date("2026-01-01"),
          },
        },
      },
      select: { id: true, editions: { select: { id: true } } },
    });
    const editionPath = `/api/social/de/festivals/${slug}/2027/`;
    const unconfirmed = await request.get(editionPath);
    expect(unconfirmed.status()).toBe(200);
    const staleTag = unconfirmed.headers().etag;
    const evidenceAt = new Date();
    const facts = { startDate: "2027-06-11", endDate: "2027-06-13" };
    await db.$transaction((tx) =>
      publishAgentFestivalResolution(tx, {
        editionId: fixtureFestival.editions[0].id,
        festivalSlug: slug,
        sourceId: `openclaw:social-preview-fixture:${slug}`,
        reason: "Synthetic edition date proof",
        facts,
        reviewedAt: evidenceAt,
        evidence: Object.keys(facts).map((field) => ({
          field,
          url: "https://festival.example.test/dates",
          checkedAt: evidenceAt.toISOString(),
          contentHash: "a".repeat(64),
          excerpt: "Synthetic official date evidence",
        })),
      }),
    );
    const confirmed = await request.get(editionPath, { headers: { "if-none-match": staleTag } });
    expect(confirmed.status()).toBe(200);
    expect(confirmed.headers().etag).not.toBe(staleTag);
    expect(await confirmed.body()).not.toEqual(await unconfirmed.body());

    for (const path of [
      "/api/social/fr/festivals/synthetic-fest/2027/",
      "/api/social/de/festivals/synthetic-fest/2029/",
      "/api/social/en/festivals/synthetic-fest/",
      "/api/social/en/artists/no-such-profile/",
      "/api/social/en/artists/sample-artist/2027/",
    ]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  } finally {
    // The audit publication is append-only. Remove only this isolated public catalogue fixture.
    if (fixtureFestival) await db.festival.delete({ where: { id: fixtureFestival.id } });
    await db.$disconnect();
  }
});
