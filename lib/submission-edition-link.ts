import type { PrismaClient } from "@prisma/client";

const action = "EDITION_LINKED";
export type SubmissionEditionLink = { editionId: string; slug: string; year: number };

export function readSubmissionEditionLink(audit: { action: string; detail: unknown }[]): SubmissionEditionLink | null {
  const detail = audit.find(item => item.action === action)?.detail;
  if (!detail || typeof detail !== "object" || !("editionId" in detail) || !("slug" in detail) || !("year" in detail) ||
      typeof detail.editionId !== "string" || typeof detail.slug !== "string" || !Number.isInteger(detail.year)) return null;
  return { editionId: detail.editionId, slug: detail.slug, year: detail.year as number };
}

function sameOfficialSite(submitted: string, canonical: string) {
  try {
    const source = new URL(submitted);
    const expected = new URL(canonical);
    if (!["https:", "http:"].includes(source.protocol) || source.username || source.password || source.port ||
        !["https:", "http:"].includes(expected.protocol) || expected.username || expected.password || expected.port) return false;
    const path = expected.pathname.replace(/\/$/, "");
    return source.hostname.replace(/^www\./, "") === expected.hostname.replace(/^www\./, "") &&
      (source.pathname === path || source.pathname.startsWith(path + "/"));
  } catch {
    return false;
  }
}

export async function linkSubmissionEdition(database: PrismaClient, reference: string, slug: string, reviewerId: string) {
  return database.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "FestivalSubmission" WHERE "publicReference" = ${reference} FOR UPDATE
    `;
    if (!locked[0]) return null;
    const submission = await tx.festivalSubmission.findUniqueOrThrow({
      where: { id: locked[0].id }, include: { audit: { where: { action }, select: { action: true, detail: true } } },
    });
    if (submission.status !== "APPROVED") return null;
    const existing = readSubmissionEditionLink(submission.audit);
    if (existing) return existing.slug === slug ? existing : null;

    const edition = await tx.festivalEdition.findFirst({
      where: { festival: { slug }, year: submission.editionYear },
      select: { id: true, year: true, festival: { select: { officialUrl: true, slug: true } } },
    });
    if (!edition || !sameOfficialSite(submission.officialUrl, edition.festival.officialUrl)) return null;
    const link: SubmissionEditionLink = { editionId: edition.id, slug: edition.festival.slug, year: edition.year };
    await tx.festivalSubmissionAudit.create({
      data: { submissionId: submission.id, actorId: reviewerId, action, detail: link },
    });
    return link;
  });
}
