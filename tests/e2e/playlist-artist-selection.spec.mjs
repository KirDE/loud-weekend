import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
const third = "Third Playlist Artist";
const thirdSlug = "third-playlist-artist";
test.beforeAll(async () => {
  const artist = await db.artist.upsert({
    where: { slug: thirdSlug },
    update: {},
    create: {
      slug: thirdSlug,
      name: third,
      aliases: [],
      genres: [],
      identityState: "UNRESOLVED",
      topTracks: [],
      recentSetlists: [],
      freshness: {},
    },
  });
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug: "synthetic-west" }, year: 2027 },
  });
  await db.lineupEntry.upsert({
    where: { editionId_artistId: { editionId: edition.id, artistId: artist.id } },
    update: {},
    create: { editionId: edition.id, artistId: artist.id, billing: "LINEUP", position: 50 },
  });
});
test.afterAll(async () => {
  await db.lineupEntry.deleteMany({ where: { artist: { slug: thirdSlug } } });
  await db.artist.deleteMany({ where: { slug: thirdSlug } });
  await db.$disconnect();
});

const copy = {
  en: [
    "Choose artists",
    "Sample Artist",
    "Second Artist",
    "Include only favorites",
    "Fallback: export deduplicated artist list",
    "Download artist list",
    "Create private Spotify playlist",
  ],
  de: [
    "Künstler auswählen",
    "Sample Artist",
    "Second Artist",
    "Nur Lieblingskünstler auswählen",
    "Alternative: eindeutige Künstlerliste exportieren",
    "Künstlerliste herunterladen",
    "Private Spotify-Playlist erstellen",
  ],
  ru: [
    "Выбрать артистов",
    "Sample Artist",
    "Second Artist",
    "Оставить только любимых",
    "Запасной вариант: экспорт уникального списка артистов",
    "Скачать список артистов",
    "Создать приватный плейлист Spotify",
  ],
};

for (const [
  language,
  [choose, first, second, favorites, fallback, download, create],
] of Object.entries(copy)) {
  test(`selection is shared by download and request and survives reload (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(() => {
      const key = "festival-radar-planner-v1";
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            favoriteArtists: ["artist:sample-artist", "artist:third-playlist-artist"],
            playlistFestivals: ["synthetic-fest", "synthetic-west"],
          }),
        );
    });
    await page.route("**/api/spotify/selection-playlist", (route) =>
      route.fulfill({ status: 409, json: { error: "Not connected" } }),
    );
    await page.goto(`/${language}/planner/`);
    await page.getByText(choose, { exact: true }).click();
    const picker = page.locator(".playlistArtistPicker");
    await expect(picker.getByRole("checkbox")).toHaveCount(3);
    await expect(picker.getByRole("checkbox", { name: first })).toBeChecked();
    await picker.getByRole("button", { name: favorites }).click();
    await expect(picker.getByRole("checkbox", { name: second })).not.toBeChecked();
    await picker.getByRole("checkbox", { name: second }).check();
    await picker.getByRole("checkbox", { name: first }).uncheck();
    await page.reload();
    await page.getByText(choose, { exact: true }).click();
    await expect(picker.getByRole("checkbox", { name: first })).not.toBeChecked();
    await expect(picker.getByRole("checkbox", { name: second })).toBeChecked();
    await expect(picker.getByRole("checkbox", { name: third })).toBeChecked();
    await page.getByText(fallback, { exact: true }).click();
    await expect(page.getByRole("link", { name: download })).toHaveAttribute(
      "href",
      "data:text/plain;charset=utf-8,Second%20Artist%0AThird%20Playlist%20Artist",
    );
    const request = page.waitForRequest("**/api/spotify/selection-playlist");
    await page.getByRole("button", { name: create }).click();
    expect((await request).postDataJSON().artists).toEqual([second, third]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
}

test("undo restores pre-reset exclusions without discarding new choices", async ({ page }) => {
  await page.addInitScript(() => {
    const key = "festival-radar-planner-v1";
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          playlistFestivals: ["synthetic-fest", "synthetic-west"],
          playlistExcludedArtists: ["sample-artist"],
        }),
      );
  });
  await page.goto("/en/planner/");
  await page.getByRole("button", { name: "Clear local data" }).click();
  await page.getByRole("button", { name: "Reset local plan" }).click();
  await page.getByRole("checkbox", { name: "Synthetic Fest", exact: true }).check();
  await page.getByText("Choose artists", { exact: true }).click();
  const picker = page.locator(".playlistArtistPicker");
  await picker.getByRole("checkbox", { name: "Second Artist", exact: true }).uncheck();
  await page.getByRole("button", { name: "Undo local reset" }).click();
  await expect(picker.getByRole("checkbox", { name: "Sample Artist" })).not.toBeChecked();
  await expect(picker.getByRole("checkbox", { name: "Second Artist" })).not.toBeChecked();
  await expect(picker.getByRole("checkbox", { name: third })).toBeChecked();
  await page.getByText("Fallback: export deduplicated artist list", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Download artist list" })).toHaveAttribute(
    "href",
    "data:text/plain;charset=utf-8,Third%20Playlist%20Artist",
  );
});
