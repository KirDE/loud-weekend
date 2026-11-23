import { db } from "../db.ts";
import type { Language } from "../language-preference.ts";
import { festivalPreviewDate, type PreviewCard, type PreviewKind } from "../social-preview.ts";

export async function readSocialPreview(
  kind: PreviewKind,
  slug: string,
  language: Language,
  year?: number,
): Promise<PreviewCard | null> {
  if (kind === "artists") {
    const artist = await db.artist.findUnique({ where: { slug }, select: { name: true } });
    // The public artist page selects profiles by current billing name, not by provider identity.
    const publicBilling =
      artist &&
      (await db.lineupEntry.findFirst({
        where: { artist: { name: artist.name }, edition: { recordState: "CURRENT" } },
        select: { id: true },
      }));
    return artist && publicBilling ? { kind, language, name: artist.name } : null;
  }

  const edition = await db.festivalEdition.findFirst({
    where: { festival: { slug }, year, recordState: { in: ["CURRENT", "ARCHIVED"] } },
    select: {
      year: true,
      status: true,
      startDate: true,
      endDate: true,
      festival: { select: { name: true } },
      provenance: {
        where: { field: { in: ["dates", "startDate", "endDate", "lineup", "headliners"] } },
        distinct: ["field"],
        select: { field: true },
      },
      lineup: {
        where: { billing: "HEADLINER", status: "ANNOUNCED" },
        orderBy: { position: "asc" },
        take: 2,
        select: { artist: { select: { name: true } } },
      },
    },
  });
  if (!edition) return null;
  const evidence = new Set(edition.provenance.map(({ field }) => field));
  const date = (value: Date | null) => value?.toISOString().slice(0, 10);
  const hasStart = evidence.has("dates") || evidence.has("startDate");
  const hasEnd = evidence.has("dates") || evidence.has("endDate");
  const hasLineup = evidence.has("lineup") || evidence.has("headliners");
  const detail = festivalPreviewDate(
    edition.year,
    language,
    edition.status !== "TBA" && hasStart
      ? {
          startDate: date(edition.startDate),
          endDate: hasEnd ? date(edition.endDate) : undefined,
        }
      : null,
  );
  return {
    kind,
    language,
    name: edition.festival.name,
    detail,
    headliners: hasLineup ? edition.lineup.map(({ artist }) => artist.name) : undefined,
  };
}
