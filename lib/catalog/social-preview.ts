import { db } from "../db.ts";
import type { Language } from "../language-preference.ts";
import { festivalPreviewDate, type PreviewCard, type PreviewKind } from "../social-preview.ts";

async function hasPublishedDate(
  slug: string,
  year: number,
  field: "startDate" | "endDate",
  value: string | undefined,
) {
  if (!value) return false;
  const receipt = await db.catalogPublication.findFirst({
    where: { festivalSlug: slug, editionYear: year, fields: { has: field } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { source: true, sourceId: true, evidence: true },
  });
  if (receipt?.source === "ADMIN" && receipt.sourceId.startsWith("admin:")) {
    const id = receipt.sourceId.slice("admin:".length);
    const evidence = receipt.evidence;
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      evidence.adminChangeId !== id ||
      !Array.isArray(evidence.sourceEvidence) ||
      !evidence.sourceEvidence.some(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          item.field === field &&
          typeof item.sourceUrl === "string" &&
          /^https?:\/\//i.test(item.sourceUrl),
      )
    )
      return false;

    const change = await db.adminChange.findFirst({
      where: {
        id,
        resourceKind: "FESTIVAL",
        resourceKey: slug,
        field,
        status: "APPROVED",
        afterValue: { equals: value },
        parserRun: { festivalSlug: slug, status: { in: ["SUCCEEDED", "PARTIAL"] } },
      },
      select: { id: true },
    });
    return Boolean(change);
  }
  if (receipt?.source !== "INGESTION" || !receipt.sourceId.startsWith("ingestion:")) return false;

  // An observation alone is not proof that this exact value was published.
  const diff = await db.ingestionDiff.findFirst({
    where: {
      candidateId: receipt.sourceId.slice("ingestion:".length),
      field,
      afterValue: { equals: value },
      reviewRequired: false,
      candidate: { festivalSlug: slug, reviewState: "PUBLISHED" },
    },
    select: { id: true },
  });
  return Boolean(diff);
}

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
  const startDate = date(edition.startDate);
  const endDate = date(edition.endDate);
  const [hasStart, hasEnd] = await Promise.all([
    evidence.has("dates") ||
      evidence.has("startDate") ||
      hasPublishedDate(slug, edition.year, "startDate", startDate),
    evidence.has("dates") ||
      evidence.has("endDate") ||
      hasPublishedDate(slug, edition.year, "endDate", endDate),
  ]);
  const hasLineup = evidence.has("lineup") || evidence.has("headliners");
  const detail = festivalPreviewDate(
    edition.year,
    language,
    hasStart
      ? {
          startDate,
          endDate: hasEnd ? endDate : undefined,
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
