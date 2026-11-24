import { z } from "zod";
export const lifecycleProposalSchema = z
  .object({
    festivalSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    editionYear: z.number().int().min(2000).max(2200),
    lifecycle: z.literal("hiatus"),
    announcedReturnYear: z.number().int().min(2000).max(2200).nullable(),
    alternativeEvent: z.literal("under_consideration").nullable(),
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    observedAt: z.iso.datetime({ precision: 3 }),
    excerpt: z.string().min(1).max(1000),
  })
  .strict()
  .refine(
    (value) => value.announcedReturnYear === null || value.announcedReturnYear > value.editionYear,
    "Return must follow paused edition",
  );
export const lifecycleReviewSchema = z
  .object({
    id: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewState: z.enum(["pending", "approved", "rejected"]),
    eligibleForReview: z.boolean(),
    proposal: lifecycleProposalSchema,
  })
  .strict()
  .refine(
    (value) => value.reviewState === "pending" || !value.eligibleForReview,
    "Decided revision cannot be eligible",
  );
export type LifecycleReview = z.infer<typeof lifecycleReviewSchema>;

/** Public, edition-scoped factual notice. Absence means unknown, NOT active.
 * A hiatus is not a ticket/lineup status and announces no replacement event. */
export const publicEditionLifecycleSchema = z
  .object({
    festivalSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    editionYear: z.number().int().min(2000).max(2200),
    lifecycle: z.literal("hiatus"),
    announcedReturnYear: z.number().int().min(2000).max(2200).nullable(),
    alternativeEvent: z.literal("under_consideration").nullable(),
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    observedAt: z.iso.datetime({ precision: 3 }),
    approvedAt: z.iso.datetime({ precision: 3 }),
  })
  .strict()
  .refine(
    (value) => value.announcedReturnYear === null || value.announcedReturnYear > value.editionYear,
    "Return must follow paused edition",
  );
export type PublicEditionLifecycle = z.infer<typeof publicEditionLifecycleSchema>;
