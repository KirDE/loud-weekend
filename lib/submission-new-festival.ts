import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalizeEvidenceWords, officialEvidenceUrl } from "./submission-follow-on-edition";
import {
  readSubmissionEditionLink,
  sameOfficialSite,
  submissionEditionLinked,
} from "./submission-edition-link";

const stagedAction = "NEW_FESTIVAL_STAGED";
const evidenceSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine((value) => normalizeEvidenceWords(value).length >= 2),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    officialUrl: officialEvidenceUrl,
    evidenceUrl: officialEvidenceUrl,
    excerpt: z.string().trim().min(8).max(500),
  })
  .strict();
export const newFestivalAction = z.discriminatedUnion("action", [
  evidenceSchema.extend({ action: z.literal("stage") }),
  z.object({ action: z.literal("publish"), draftId: z.string().min(1).max(60) }).strict(),
]);

export function readNewFestivalDraft(
  audit: { action: string; detail: unknown; id: string; createdAt: Date }[],
) {
  const latest = audit.findLast((item) => item.action === stagedAction);
  const evidence = evidenceSchema.safeParse(latest?.detail);
  return latest && evidence.success
    ? { id: latest.id, checkedAt: latest.createdAt.toISOString(), ...evidence.data }
    : null;
}

const regionLabels = ["en", "de", "ru"].map(
  (locale) => new Intl.DisplayNames(locale, { type: "region", fallback: "none" }),
);
const includesWords = (excerpt: string, phrase: string) =>
  ` ${excerpt} `.includes(` ${normalizeEvidenceWords(phrase)} `);
const sitesOverlap = (left: string, right: string) =>
  sameOfficialSite(left, right) || sameOfficialSite(right, left);

export async function reviewNewFestival(
  db: PrismaClient,
  reference: string,
  input: z.infer<typeof newFestivalAction>,
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
    if (linked) {
      const detail = submission.audit.find(
        (item) => item.action === submissionEditionLinked,
      )?.detail;
      return input.action === "publish" &&
        detail &&
        typeof detail === "object" &&
        "newFestivalDraftId" in detail &&
        detail.newFestivalDraftId === input.draftId
        ? { state: "linked" as const, link: linked }
        : null;
    }

    const draft = readNewFestivalDraft(submission.audit);
    if (input.action === "publish" && draft?.id !== input.draftId) return null;
    const evidence = input.action === "stage" ? input : draft;
    if (!evidence) return null;
    const { slug, name, countryCode, officialUrl, evidenceUrl, excerpt } = evidence;
    const normalized = normalizeEvidenceWords(excerpt);
    if (
      !sameOfficialSite(submission.officialUrl, officialUrl) ||
      !sameOfficialSite(evidenceUrl, officialUrl) ||
      !includesWords(normalized, name) ||
      !includesWords(normalized, String(submission.editionYear))
    )
      return null;

    // Serialize duplicate detection and creation across independent submissions,
    // including different proposed slugs for the same name or website.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(428, 427)`;
    const catalogue = await tx.festival.findMany({
      select: { id: true, slug: true, name: true, countryCode: true, officialUrl: true },
    });
    const country = regionLabels[0].of(countryCode);
    if (
      !country ||
      !catalogue.some((festival) => festival.countryCode === countryCode) ||
      !regionLabels.some((labels) => {
        const label = labels.of(countryCode);
        return label && includesWords(normalized, label);
      })
    )
      return null;

    const detail = { slug, name, countryCode, officialUrl, evidenceUrl, excerpt };
    const candidates = catalogue.filter(
      (festival) =>
        festival.slug === slug ||
        normalizeEvidenceWords(festival.name) === normalizeEvidenceWords(name) ||
        sitesOverlap(officialUrl, festival.officialUrl),
    );
    if (input.action === "stage") {
      if (candidates.length) return null;
      if (
        draft &&
        Object.entries(detail).every(([key, value]) => draft[key as keyof typeof detail] === value)
      ) {
        return { state: "staged" as const, draft };
      }
      const entry = await tx.festivalSubmissionAudit.create({
        data: { submissionId: submission.id, actorId, action: stagedAction, detail },
        select: { id: true, createdAt: true },
      });
      return {
        state: "staged" as const,
        draft: { id: entry.id, checkedAt: entry.createdAt.toISOString(), ...detail },
      };
    }

    if (!draft) return null;
    let editionId: string;
    if (candidates.length) {
      // A concurrent reviewed publication can be reused only when its entire
      // canonical identity and exact edition already match this draft.
      const [existing] = candidates;
      if (
        candidates.length !== 1 ||
        existing.slug !== slug ||
        existing.name !== name ||
        existing.countryCode !== countryCode ||
        existing.officialUrl !== officialUrl
      )
        return null;
      const edition = await tx.festivalEdition.findUnique({
        where: { festivalId_year: { festivalId: existing.id, year: submission.editionYear } },
        select: { id: true },
      });
      if (!edition) return null;
      editionId = edition.id;
    } else {
      const checkedAt = new Date(draft.checkedAt);
      const festival = await tx.festival.create({
        data: {
          slug,
          name,
          country,
          countryCode,
          officialUrl,
          genres: [],
          editions: {
            create: {
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
                  note: "Official festival and edition announcement reviewed.",
                },
              },
            },
          },
        },
        select: { editions: { select: { id: true } } },
      });
      editionId = festival.editions[0].id;
    }

    const link = { editionId, slug, year: submission.editionYear };
    await tx.festivalSubmissionAudit.create({
      data: {
        submissionId: submission.id,
        actorId,
        action: submissionEditionLinked,
        detail: { ...link, newFestivalDraftId: draft.id, createdFestival: !candidates.length },
      },
    });
    return { state: "linked" as const, link };
  });
}
