import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  readSubmissionEditionLink,
  sameOfficialSite,
  submissionEditionLinked,
} from "./submission-edition-link";

const stagedAction = "FOLLOW_ON_EDITION_STAGED";
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,179}$/);
export const officialEvidenceUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  });
const reviewedEvidence = z.object({
  slug: slugSchema,
  evidenceUrl: officialEvidenceUrl,
  excerpt: z.string().trim().min(8).max(500),
});
export const followOnAction = z.discriminatedUnion("action", [
  reviewedEvidence.extend({ action: z.literal("stage") }).strict(),
  z.object({ action: z.literal("publish"), draftId: z.string().min(1).max(60) }).strict(),
]);
type Action = z.infer<typeof followOnAction>;

export const normalizeEvidenceWords = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function readFollowOnDraft(
  audit: { action: string; detail: unknown; id: string; createdAt: Date }[],
) {
  const latest = audit.findLast((item) => item.action === stagedAction);
  const evidence = reviewedEvidence.safeParse(latest?.detail);
  return latest && evidence.success
    ? { id: latest.id, checkedAt: latest.createdAt.toISOString(), ...evidence.data }
    : null;
}

export async function reviewFollowOnEdition(
  db: PrismaClient,
  reference: string,
  action: Action,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "FestivalSubmission" WHERE "publicReference" = ${reference} FOR UPDATE
    `;
    if (!locked) return null;
    const submission = await tx.festivalSubmission.findUniqueOrThrow({
      where: { id: locked.id },
      include: { audit: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (submission.status !== "APPROVED") return null;
    const linked = readSubmissionEditionLink(submission.audit);
    const draft = readFollowOnDraft(submission.audit);
    if (linked) {
      const publication = submission.audit.find(
        (item) => item.action === submissionEditionLinked,
      )?.detail;
      return action.action === "publish" &&
        publication &&
        typeof publication === "object" &&
        "followOnDraftId" in publication &&
        publication.followOnDraftId === action.draftId
        ? { state: "linked" as const, link: linked }
        : null;
    }

    const evidence = action.action === "stage" ? action : draft;
    if (!evidence || (action.action === "publish" && draft?.id !== action.draftId)) return null;
    const { slug, evidenceUrl, excerpt } = evidence;
    const [festival] = await tx.$queryRaw<{ id: string; name: string; officialUrl: string }[]>`
      SELECT "id", "name", "officialUrl" FROM "Festival" WHERE "slug" = ${slug} FOR UPDATE
    `;
    if (
      !festival ||
      !sameOfficialSite(submission.officialUrl, festival.officialUrl) ||
      !sameOfficialSite(evidenceUrl, festival.officialUrl) ||
      !normalizeEvidenceWords(excerpt).split(" ").includes(String(submission.editionYear)) ||
      !` ${normalizeEvidenceWords(excerpt)} `.includes(` ${normalizeEvidenceWords(festival.name)} `)
    )
      return null;

    const current = await tx.festivalEdition.findFirst({
      where: { festivalId: festival.id, recordState: "CURRENT" },
      orderBy: { year: "desc" },
      select: { year: true },
    });
    if (!current || submission.editionYear <= current.year) return null;
    const exists = await tx.festivalEdition.findUnique({
      where: { festivalId_year: { festivalId: festival.id, year: submission.editionYear } },
      select: { id: true },
    });
    if (exists && action.action === "stage") return null;

    if (action.action === "stage") {
      if (draft?.slug === slug && draft.evidenceUrl === evidenceUrl && draft.excerpt === excerpt) {
        return { state: "staged" as const, draft };
      }
      const detail = { slug, evidenceUrl, excerpt };
      const entry = await tx.festivalSubmissionAudit.create({
        data: { submissionId: submission.id, actorId, action: stagedAction, detail },
        select: { id: true, createdAt: true },
      });
      return {
        state: "staged" as const,
        draft: { id: entry.id, checkedAt: entry.createdAt.toISOString(), ...detail },
      };
    }

    // A different submission might have already created this edition. Reuse
    // the row instead of writing a second edition or refreshing its evidence.
    if (!draft) return null;
    const checkedAt = new Date(draft.checkedAt);
    const edition =
      exists ??
      (await tx.festivalEdition.create({
        data: {
          festivalId: festival.id,
          year: submission.editionYear,
          recordState: "TRACKING",
          status: "TBA",
          ticketStatus: "UNKNOWN",
          completeness: "TBA",
          sourceUpdatedAt: checkedAt,
          provenance: {
            create: {
              field: "edition",
              url: evidenceUrl,
              checkedAt,
              note: "Official edition announcement reviewed.",
            },
          },
        },
        select: { id: true },
      }));
    const link = { editionId: edition.id, slug, year: submission.editionYear };
    await tx.festivalSubmissionAudit.create({
      data: {
        submissionId: submission.id,
        actorId,
        action: submissionEditionLinked,
        detail: { ...link, followOnDraftId: action.draftId, createdEdition: !exists },
      },
    });
    return { state: "linked" as const, link };
  });
}
