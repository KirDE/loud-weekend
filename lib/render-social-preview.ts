import { join } from "node:path";
import sharp from "sharp";
import { previewLabel, previewSize, previewText, type PreviewCard } from "./social-preview.ts";

// Use the same bundled Geist typeface as the framework OG renderer, without its remote fallback requests.
const fontfile = join(
  process.cwd(),
  "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
);
const paper = "#171712";
const white = "#faf9f1";
const muted = "#bbb9ac";

async function textLayer(
  text: string,
  size: number,
  colour: string,
  top: number,
  height: number,
  width = 1000,
) {
  const escaped = text.replace(/[&<>]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;",
  );
  const input = await sharp({
    text: {
      text: `<span foreground="${colour}">${escaped}</span>`,
      font: `Geist ${size}`,
      fontfile,
      width,
      height,
      rgba: true,
      wrap: "word-char",
    },
  })
    .png()
    .toBuffer();
  return { input, top, left: 76 };
}

export async function renderSocialPreview(card: PreviewCard): Promise<Buffer> {
  const colour = card.kind === "festivals" ? "#d7ff3f" : "#ff8a69";
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <path fill="${colour}" d="M0 0H20V630H0z"/>
    <path fill="#24241c" d="M950 0h180L830 630H650zM1155 0h45v300L1045 630H870z"/>
    <path fill="${colour}" d="M76 524h1048v3H76z"/>
  </svg>`);
  const headliners = card.headliners
    ?.map((name) => previewText(name, 35))
    .filter(Boolean)
    .join("  /  ");
  const layers = await Promise.all([
    textLayer(previewLabel(card), 31, colour, 68, 45, 440),
    textLayer(previewText(card.name, 76) || previewLabel(card), 84, white, 153, 210),
    ...(card.detail ? [textLayer(card.detail, 37, white, 375, 51)] : []),
    ...(headliners ? [textLayer(headliners, 30, muted, 447, 45)] : []),
    textLayer("Loud Weekend", 25, muted, 551, 35, 420),
  ]);
  return sharp({ create: { ...previewSize, channels: 3, background: paper } })
    .composite([{ input: backdrop }, ...layers])
    .png()
    .toBuffer();
}
