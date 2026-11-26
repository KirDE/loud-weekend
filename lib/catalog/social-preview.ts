import { artistAliasIndex } from "./artist-aliases.ts";
import type { Prisma } from "@prisma/client";
import { db } from "../db.ts";
import type { Language } from "../language-preference.ts";
import { festivalPreviewDate, type PreviewCard, type PreviewKind } from "../social-preview.ts";

type EditionScope = { id: string; year: number };

function parserEvidenceKind(
  evidence: Prisma.JsonValue,
  id: string,
  field: string,
  edition: EditionScope,
): "legacy" | "scoped-refresh" | undefined {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return undefined;
  if (evidence.adminChangeId !== id) return undefined;

  let entries = evidence.sourceEvidence;
  let kind: "legacy" | "scoped-refresh" = "legacy";
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    if (
      entries.kind !== "scoped-refresh" ||
      entries.editionId !== edition.id ||
      entries.editionYear !== edition.year
    )
      return undefined;
    kind = "scoped-refresh";
    entries = entries.evidence;
  }
  const hasField =
    Array.isArray(entries) &&
    entries.some(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.field === field &&
        typeof item.sourceUrl === "string" &&
        /^https?:\/\//i.test(item.sourceUrl),
    );
  return hasField ? kind : undefined;
}

async function hasPublishedDate(
  tx: Prisma.TransactionClient,
  slug: string,
  edition: EditionScope,
  field: "startDate" | "endDate",
  value: string | undefined,
  hasProvenance: boolean,
) {
  if (!value) return false;
  const receipt = await tx.catalogPublication.findFirst({
    where: { festivalSlug: slug, editionYear: edition.year, fields: { has: field } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { source: true, sourceId: true, evidence: true },
  });
  if (!receipt) return hasProvenance;

  if (receipt.source === "ADMIN" && receipt.sourceId.startsWith("admin:")) {
    const id = receipt.sourceId.slice("admin:".length);
    const evidence = receipt.evidence;
    if (!parserEvidenceKind(evidence, id, field, edition)) return false;

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
  edition: EditionScope,
  roster: { id: string; name: string }[],
  hasProvenance: boolean,
) {
  if (!roster.length) return [];
  const scope = { festivalSlug: slug, editionYear: edition.year, fields: { has: "headliners" } };
  const receipts = await tx.catalogPublication.findMany({
    where: { ...scope, source: { in: ["ADMIN", "INGESTION"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, source: true, sourceId: true, evidence: true },
  });
  const reviewedKind = (receipt: (typeof receipts)[number]) =>
    receipt.source === "ADMIN" && receipt.sourceId.startsWith("admin:")
      ? parserEvidenceKind(receipt.evidence, receipt.sourceId.slice(6), "headliners", edition)
      : undefined;
  // An unsupported replacement invalidates all earlier roster proof; a scoped
  // refresh can carry independent proof only for names it actually retains.
  const resetAt = receipts.findIndex(
    (receipt) => receipt.source === "ADMIN" && reviewedKind(receipt) !== "scoped-refresh",
  );
  const active = resetAt < 0 ? receipts : receipts.slice(0, resetAt + 1);
  const reset = resetAt < 0 ? undefined : receipts[resetAt];
  const provenanceApplies = hasProvenance && (!reset || reset.sourceId.startsWith("openclaw:"));
  const reviewed = active.filter(reviewedKind);
  if (provenanceApplies && !reviewed.length) return roster.slice(0, 2).map(({ name }) => name);

  const changes = reviewed.length
    ? await tx.adminChange.findMany({
        where: {
          id: { in: reviewed.map(({ sourceId }) => sourceId.slice(6)) },
          resourceKind: "FESTIVAL",
          resourceKey: slug,
          field: "headliners",
          status: "APPROVED",
          parserRun: { festivalSlug: slug, status: { in: ["SUCCEEDED", "PARTIAL"] } },
        },
        select: { id: true, beforeValue: true, afterValue: true },
      })
    : [];
  const changesBySource = new Map(changes.map((change) => [`admin:${change.id}`, change]));
  const receiptIds = new Map(
    active.filter(({ source }) => source === "INGESTION").map(({ id, sourceId }) => [sourceId, id]),
  );
  const diffs = receiptIds.size
    ? await tx.ingestionDiff.findMany({
        where: {
          field: "headliners",
          reviewRequired: false,
          candidate: {
            festivalSlug: slug,
            reviewState: "PUBLISHED",
            catalogueVersion: { in: [...receiptIds.values()] },
            evidence: { some: { field: "headliners" } },
          },
        },
        select: { afterValue: true, candidate: { select: { id: true, catalogueVersion: true } } },
      })
    : [];
  const additions = new Map<string, string[]>();
  for (const { afterValue, candidate } of diffs) {
    const sourceId = `ingestion:${candidate.id}`;
    if (typeof afterValue === "string" && receiptIds.get(sourceId) === candidate.catalogueVersion) {
      const names = additions.get(sourceId) ?? [];
      names.push(afterValue);
      additions.set(sourceId, names);
    }
  }
  if (!changes.length && !additions.size) return [];

  const lookup = artistAliasIndex(
    await tx.artist.findMany({ select: { id: true, slug: true, name: true, aliases: true } }),
    { orthography: true },
  );
  const artistIds = (names: readonly Prisma.JsonValue[]) =>
    new Set(
      names.flatMap((name) => {
        if (typeof name !== "string") return [];
        const matches = lookup(name);
        return matches.length === 1 ? [matches[0].id] : [];
      }),
    );
  const verified = new Set<string>();
  let eligible = new Set(roster.map(({ id }) => id));
  let baselineAllowed = provenanceApplies;
  for (const receipt of active) {
    if (receipt.source === "INGESTION") {
      for (const id of artistIds(additions.get(receipt.sourceId) ?? [])) {
        if (eligible.has(id)) verified.add(id);
      }
      continue;
    }
    if (receipt.sourceId.startsWith("openclaw:")) break;

    const change = changesBySource.get(receipt.sourceId);
    const kind = reviewedKind(receipt);
    if (!Array.isArray(change?.afterValue) || !kind) {
      baselineAllowed = false;
      break;
    }
    const after = artistIds(change.afterValue);
    if (kind === "legacy") {
      for (const id of after) if (eligible.has(id)) verified.add(id);
      break;
    }
    if (!Array.isArray(change.beforeValue)) {
      baselineAllowed = false;
      break;
    }
    const before = artistIds(change.beforeValue);
    for (const id of after) if (eligible.has(id) && !before.has(id)) verified.add(id);
    eligible = new Set([...eligible].filter((id) => before.has(id) && after.has(id)));
  }
  if (baselineAllowed) for (const id of eligible) verified.add(id);
  return roster
    .filter(({ id }) => verified.has(id))
    .slice(0, 2)
    .map(({ name }) => name);
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
        where: {
          artist: { name: artist.name },
          edition: { recordState: "CURRENT" },
          status: "ANNOUNCED",
        },
        select: { id: true },
      }));
    return artist && publicBilling ? { kind, language, name: artist.name } : null;
  }

  return db.$transaction(
    async (tx) => {
      const edition = await tx.festivalEdition.findFirst({
        where: { festival: { slug }, year, recordState: { in: ["CURRENT", "ARCHIVED"] } },
        select: {
          id: true,
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
            select: { artist: { select: { id: true, name: true } } },
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
          edition,
          "startDate",
          startDate,
          evidence.has("dates") || evidence.has("startDate"),
        ),
        hasPublishedDate(
          tx,
          slug,
          edition,
          "endDate",
          endDate,
          evidence.has("dates") || evidence.has("endDate"),
        ),
        publishedHeadliners(
          tx,
          slug,
          edition,
          edition.lineup.map(({ artist }) => artist),
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
