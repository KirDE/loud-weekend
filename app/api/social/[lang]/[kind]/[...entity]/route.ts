import { createHash } from "node:crypto";
import { readSocialPreview } from "@/lib/catalog/social-preview";
import { isLanguage } from "@/lib/language-preference";
import { renderSocialPreview } from "@/lib/render-social-preview";

export const dynamic = "force-dynamic";

type Params = { lang: string; kind: string; entity: string[] };

export async function GET(request: Request, { params }: { params: Promise<Params> }) {
  const { lang, kind, entity } = await params;
  const [slug, year] = entity;
  if (
    !isLanguage(lang) ||
    !slug ||
    !/^[a-z0-9-]{1,160}$/.test(slug) ||
    (kind !== "artists" && kind !== "festivals") ||
    (kind === "artists" ? entity.length !== 1 : entity.length !== 2 || !/^\d{4}$/.test(year))
  ) {
    return new Response(null, { status: 404 });
  }
  const card = await readSocialPreview(kind, slug, lang, year ? Number(year) : undefined);
  if (!card) return new Response(null, { status: 404 });

  const validator = createHash("sha256")
    .update(JSON.stringify([1, card]))
    .digest("base64url");
  const etag = `W/"${validator}"`;
  const headers = {
    "Cache-Control": "public, max-age=300, s-maxage=900",
    ETag: etag,
    "Content-Type": "image/png",
  };
  const conditional = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((value) => value.trim().replace(/^W\//, ""));
  if (conditional?.includes(`"${validator}"`) || conditional?.includes("*"))
    return new Response(null, { status: 304, headers });
  const bytes = await renderSocialPreview(card);
  return new Response(new Uint8Array(bytes), { headers });
}
