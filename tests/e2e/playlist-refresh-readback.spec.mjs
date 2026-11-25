import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

test("only the latest requested-provider failure is shown without replacing the last verified playlist", async ({
  page,
  browser,
}) => {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  const db = createPrismaClient();
  const slug = "synthetic-west";
  const ids = [];
  const keys = [];
  const previous = [];
  const added = [];
  try {
    const edition = await db.festivalEdition.findFirstOrThrow({
      where: { festival: { slug }, recordState: "CURRENT" },
    });
    const publish = async (scope, year, createdAt) => {
      const publication = await db.catalogPublication.create({
        data: {
          source: "ADMIN",
          sourceId: `browser-coverage:${randomUUID()}`,
          festivalSlug: slug,
          editionYear: year,
          actorLabel: "Synthetic",
          fields: ["lineup"],
          lineupChanged: true,
          evidence: { providers: scope },
          createdAt,
          playlistRefresh: { create: { festivalSlug: slug, status: "FAILED" } },
        },
        include: { playlistRefresh: true },
      });
      ids.push(publication.id);
      return publication.playlistRefresh.id;
    };
    const state = async (provider, jobId, status, diagnostic, overrides = {}) => {
      const key = `playlist-provider:v1:${provider}:${jobId}`;
      const payload = {
        version: 1,
        provider,
        jobId,
        status,
        diagnostic,
        attempts: 1,
        ...overrides,
      };
      await db.operationalState.upsert({
        where: { key },
        create: { key, payload },
        update: { payload },
      });
      keys.push(key);
    };
    const playlist = async (provider, data) => {
      const where = { editionId_provider: { editionId: edition.id, provider } };
      const row = await db.festivalPlaylist.findUnique({ where });
      if (row) previous.push(row);
      const saved = await db.festivalPlaylist.upsert({
        where,
        create: { editionId: edition.id, provider, ...data },
        update: data,
      });
      if (!row) added.push(saved.id);
    };
    await playlist("spotify", {
      url: "https://open.spotify.com/playlist/x000000000000000000000",
      artistCount: 110,
      trackCount: 220,
      syncedAt: new Date("2026-11-18T10:00:00Z"),
    });
    await playlist("youtube_music", {
      url: "https://music.youtube.com/playlist?list=PLSyntheticReadback0123456789",
      artistCount: 8,
      trackCount: 14,
      syncedAt: new Date("2026-11-19T10:00:00Z"),
    });
    const original = await publish(
      ["spotify", "youtube_music"],
      edition.year,
      new Date("2026-11-21T10:00:00Z"),
    );
    const oldFailure = await publish(["spotify"], edition.year, new Date("2026-11-20T10:00:00Z"));
    const archived = await publish(
      ["youtube_music"],
      edition.year - 1,
      new Date("2026-11-22T10:00:00Z"),
    );
    await state("spotify", original, "SUCCEEDED");
    await state(
      "spotify",
      oldFailure,
      "FAILED",
      "playlist_worker_failed stage=spotify_apply reason=spotify_readback_mismatch",
    );
    await state(
      "youtube_music",
      archived,
      "FAILED",
      "playlist_worker_failed stage=youtube_apply reason=youtube_provider_quota_exceeded",
    );
    const failed = [
      ["en", "Latest refresh failed"],
      ["de", "Letzte Aktualisierung fehlgeschlagen"],
      ["ru", "Последнее обновление не удалось"],
    ];
    await page.goto(`/en/festivals/${slug}/`);
    await expect(page.getByText(failed[0][1], { exact: true })).toHaveCount(0);

    const youtubeJob = await publish(
      ["youtube_music"],
      edition.year,
      new Date("2026-11-23T10:00:00Z"),
    );
    await state(
      "youtube_music",
      youtubeJob,
      "FAILED",
      "playlist_worker_failed stage=youtube_apply reason=youtube_provider_quota_exceeded",
    );
    for (const [locale, status] of failed) {
      const localized = await browser.newContext({ viewport: { width: 320, height: 720 }, locale });
      try {
        const detail = await localized.newPage();
        await detail.goto(`/${locale}/festivals/${slug}/`);
        await expect(detail.getByText(status, { exact: true })).toHaveCount(1);
        const youtube = detail.locator("a[href*='music.youtube.com/playlist']");
        await expect(youtube.getByText(status, { exact: true })).toBeVisible();
        await expect(youtube.locator("time")).toHaveAttribute(
          "datetime",
          "2026-11-19T10:00:00.000Z",
        );
        await expect(
          detail.getByText("youtube_provider_quota_exceeded", { exact: false }),
        ).toHaveCount(0);
        expect(
          await detail.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(320);
      } finally {
        await localized.close();
      }
    }
    const latestSpotify = await publish(
      ["spotify"],
      edition.year,
      new Date("2026-11-24T10:00:00Z"),
    );
    await state(
      "spotify",
      latestSpotify,
      "FAILED",
      "playlist_worker_failed stage=spotify_discovery reason=spotify_discovery_checkpoint",
    );
    await page.goto(`/en/festivals/${slug}/`);
    await expect(page.getByText(failed[0][1], { exact: true })).toHaveCount(1);

    // A fresher verified provider checkpoint supersedes a stale failure state.
    await db.festivalPlaylist.update({
      where: { editionId_provider: { editionId: edition.id, provider: "youtube_music" } },
      data: { syncedAt: new Date("2099-01-01T00:00:00Z") },
    });
    await page.reload();
    await expect(page.getByText(failed[0][1], { exact: true })).toHaveCount(0);
  } finally {
    await db.operationalState.deleteMany({ where: { key: { in: keys } } });
    await db.catalogPlaylistRefresh.deleteMany({ where: { publicationId: { in: ids } } });
    // Publication records are append-only in the disposable fixture database.
    await db.festivalPlaylist.deleteMany({ where: { id: { in: added } } });
    for (const { id, url, artistCount, trackCount, syncedAt } of previous) {
      await db.festivalPlaylist.update({
        where: { id },
        data: { url, artistCount, trackCount, syncedAt },
      });
    }
    await db.$disconnect();
  }
});
