import { z } from "zod";
export const lifecycleProposalSchema = z.object({
  festivalSlug: z.literal("rock-en-seine"), editionYear: z.literal(2027),
  lifecycle: z.literal("hiatus"), announcedReturnYear: z.literal(2028),
  alternativeEvent: z.literal("under_consideration"), sourceUrl: z.literal("https://www.rockenseine.com/"),
  observedAt: z.iso.datetime({ precision: 3 }),
  excerpt: z.literal("Rock en Seine: festival pauses in 2027 and announces a return in 2028. A different 2027 event is only under consideration, not confirmed. No ordinary 2027 ticket inventory assertion."),
}).strict();
export const lifecycleReviewSchema = z.object({
  id: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewState: z.enum(["pending", "approved", "rejected"]), eligibleForReview: z.boolean(),
  proposal: lifecycleProposalSchema,
}).strict().refine(value => value.reviewState === "pending" || !value.eligibleForReview, "Decided revision cannot be eligible");
export type LifecycleReview = z.infer<typeof lifecycleReviewSchema>;
