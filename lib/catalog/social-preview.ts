import type { Prisma } from "@prisma/client";
import { db } from "../db.ts";
import type { Language } from "../language-preference.ts";
import { festivalPreviewDate, type PreviewCard, type PreviewKind } from "../social-preview.ts";

function hasParserEvidence(evidence: Prisma.JsonValue, id: string, field: string) {
  return (
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    evidence.adminChangeId === id &&
    Array.isArray(evidence.sourceEvidence) &&
    evidence.sourceEvidence.some(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.field === field &&
        typeof item.sourceUrl === "string" &&
        /^https?:\/\//i.test(item.sourceUrl),
    )
  );
}

async function hasPublishedDate(
  tx: Prisma.TransactionClient,
  slug: string,
  year: number,
  field: "startDate" | "endDate",
  value: string | undefined,
  hasProvenance: boolean,
) {
  if (!value) return false;
  const receipt = await tx.catalogPublication.findFirst({
    where: { festivalSlug: slug, editionYear: year, fields: { has: field } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { source: true, sourceId: true, evidence: true },
  });
  if (!receipt) return hasProvenance;

  if (receipt.source === "ADMIN" && receipt.sourceId.startsWith("admin:")) {
    const id = receipt.sourceId.slice("admin:".length);
    const evidence = receipt.evidence;
    if (!hasParserEvidence(evidence, id, field)) return false;

    const change = await tx.adminChange.findFirst({
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
  if (receipt.source === "ADMIN" && receipt.sourceId.startsWith("openclaw:")) {
    const evidence = receipt.evidence;
    return (
      hasProvenance &&
      evidence !== null &&
      typeof evidence === "object" &&
      !Array.isArray(evidence) &&
      evidence.reviewPolicy === "openclaw-import-conflicts-v1" &&
      Array.isArray(evidence.officialEvidence) &&
      evidence.officialEvidence.some(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          item.field === field &&
          typeof item.url === "string" &&
          /^https?:\/\//i.test(item.url),
      )
    );
  }
  if (receipt.source !== "INGESTION" || !receipt.sourceId.startsWith("ingestion:")) return false;

  // An observation alone is not proof that this exact value was published.
  const diff = await tx.ingestionDiff.findFirst({
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

async function publishedHeadliners(
  tx: Prisma.TransactionClient,
  slug: string,
  year: number,
  names: string[],
  hasProvenance: boolean,
) {
  if (!names.length) return [];
  const scope = { festivalSlug: slug, editionYear: year, fields: { has: "headliners" } };
  const replacement = await tx.catalogPublication.findFirst({
    where: { ...scope, source: "ADMIN" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, sourceId: true, createdAt: true, evidence: true },
  });

  // Admin edits replace the headliner list. Evidence for an older list cannot
  // verify a name reintroduced by a later unsupported replacement.
  const verified = new Set<string>();
  if (!replacement || replacement.sourceId.startsWith("openclaw:")) {
    if (hasProvenance) names.forEach((name) => verified.add(name));
  } else if (replacement.sourceId.startsWith("admin:")) {
    const id = replacement.sourceId.slice("admin:".length);
    if (hasParserEvidence(replacement.evidence, id, "headliners")) {
      const change = await tx.adminChange.findFirst({
        where: {
          id,
          resourceKind: "FESTIVAL",
          resourceKey: slug,
          field: "headliners",
          status: "APPROVED",
          parserRun: { festivalSlug: slug, status: { in: ["SUCCEEDED", "PARTIAL"] } },
        },
        select: { afterValue: true },
      });
      const after = change?.afterValue;
      if (Array.isArray(after)) {
        for (const name of names) if (after.includes(name)) verified.add(name);
      }
    }
  }

  const missing = names.filter((name) => !verified.has(name));
  if (!missing.length) return names;
  const additions = await tx.catalogPublication.findMany({
    where: {
      ...scope,
      source: "INGESTION",
      ...(replacement && {
        OR: [
          { createdAt: { gt: replacement.createdAt } },
          { createdAt: replacement.createdAt, id: { gt: replacement.id } },
        ],
      }),
    },
    select: { id: true, sourceId: true },
  });
  if (!additions.length) return names.filter((name) => verified.has(name));

  const receiptIds = new Map(additions.map(({ id, sourceId }) => [sourceId, id]));
  const diffs = await tx.ingestionDiff.findMany({
    where: {
      field: "headliners",
      reviewRequired: false,
      OR: missing.map((name) => ({ afterValue: { equals: name } })),
      candidate: {
        festivalSlug: slug,
        reviewState: "PUBLISHED",
        catalogueVersion: { in: additions.map(({ id }) => id) },
        evidence: { some: { field: "headliners" } },
      },
    },
    select: { afterValue: true, candidate: { select: { id: true, catalogueVersion: true } } },
  });
  for (const { afterValue, candidate } of diffs) {
    if (
      typeof afterValue === "string" &&
      receiptIds.get(`ingestion:${candidate.id}`) === candidate.catalogueVersion
    ) {
      verified.add(afterValue);
    }
  }
  return names.filter((name) => verified.has(name));
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

  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirst({
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
      const [hasStart, hasEnd, headliners] = await Promise.all([
        hasPublishedDate(
          tx,
          slug,
          edition.year,
          "startDate",
          startDate,
          evidence.has("dates") || evidence.has("startDate"),
        ),
        hasPublishedDate(
          tx,
          slug,
          edition.year,
          "endDate",
          endDate,
          evidence.has("dates") || evidence.has("endDate"),
        ),
        publishedHeadliners(
          tx,
          slug,
          edition.year,
          edition.lineup.map(({ artist }) => artist.name),
          evidence.has("headliners") || evidence.has("lineup"),
        ),
      ]);
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
        headliners: headliners.length ? headliners : undefined,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
