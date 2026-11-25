import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  festivalPreviewDate,
  previewSize,
  previewText,
  socialPreviewMetadata,
} from "../lib/social-preview.ts";
import { renderSocialPreview } from "../lib/render-social-preview.ts";

test("locale and edition are encoded in matching Open Graph and Twitter images", () => {
  const metadata = socialPreviewMetadata(
    { kind: "festivals", slug: "festival", name: "Test & Fest", year: 2028 },
    "/de/festivals/festival/",
    "de",
  );
  const image = metadata.openGraph.images[0];
  assert.match(image.url, /\/api\/social\/de\/festivals\/festival\/2028\/$/);
  assert.equal(metadata.openGraph.url, "https://loudweekend.eu/de/festivals/festival/");
  assert.equal(image.alt, "Festival: Test & Fest · 2028");
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  assert.deepEqual(metadata.twitter.images[0], image);
  assert.equal(metadata.twitter.card, "summary_large_image");
  const artist = socialPreviewMetadata(
    { kind: "artists", slug: "act", name: "Акт" },
    "/ru/artists/act/",
    "ru",
  );
  assert.match(artist.openGraph.images[0].url, /\/api\/social\/ru\/artists\/act\/$/);
  assert.equal(artist.openGraph.images[0].alt, "Артист: Акт");
});

test("unknown and impossible dates never produce a day or month", () => {
  for (const [language, message] of [
    ["en", "Dates not confirmed"],
    ["de", "Termine nicht bestätigt"],
    ["ru", "Даты не подтверждены"],
  ]) {
    assert.equal(festivalPreviewDate(2028, language, null), `2028 · ${message}`);
    assert.equal(
      festivalPreviewDate(2028, language, { startDate: "2028-02-30" }),
      `2028 · ${message}`,
    );
  }
  assert.match(
    festivalPreviewDate(2028, "de", { startDate: "2028-02-29", endDate: "2028-03-02" }),
    /29\. Feb.*2\. März/,
  );
});

test("visual truncation preserves grapheme clusters and removes direction overrides", () => {
  assert.equal(previewText("  Акт  \u202eслово\n& Name  ", 40), "Акт слово & Name");
  assert.equal(previewText("A\u0308👩‍🎤Шоу", 2), "A\u0308👩‍🎤…");
});

test("PNG rendering is deterministic, bounded, and distinct for names, kinds and locales", async () => {
  const card = { kind: "artists", language: "ru", name: "Тест <Артист> & Музыка" };
  const render = await renderSocialPreview(card);
  const metadata = await sharp(render).metadata();
  assert.equal(metadata.format, "png");
  assert.deepEqual({ width: metadata.width, height: metadata.height }, previewSize);
  assert.deepEqual(await renderSocialPreview(card), render);
  assert.notDeepEqual(await renderSocialPreview({ ...card, name: "Другое имя" }), render);
  assert.notDeepEqual(await renderSocialPreview({ ...card, language: "de" }), render);
  const festival = await renderSocialPreview({
    ...card,
    kind: "festivals",
    name: "Ш".repeat(1000),
    detail: "2028 · Даты не подтверждены",
    headliners: ["A & B", "C < D"],
  });
  assert.notDeepEqual(festival, render);
  assert.ok(festival.byteLength < 500_000);
});
