import { z } from "zod";
const sourceUrl = "https://hellfest.fr/";
const iso = z.string().datetime({ precision: 3 });
const offer = z.object({
  key: z.string(), kind: z.enum(["full_pass", "day_pass"]), label: z.string().min(1).max(80),
  status: z.enum(["sold_out", "not_on_sale", "unknown"]),
  price: z.object({ amountMinor: z.number().int().min(0).max(9_999_999), currency: z.literal("EUR"), fees: z.literal("unknown") }).strict().nullable(),
  saleDateText: z.string().min(1).max(120).nullable(), sourceUrl: z.literal(sourceUrl), observedAt: iso,
  excerpt: z.string().min(1).max(500),
}).strict();
export const hellfestProposalSchema = z.object({
  festivalSlug: z.literal("hellfest"), editionYear: z.number().int().min(2000).max(2100),
  sourceUrl: z.literal(sourceUrl), observedAt: iso, offers: z.array(offer).length(2), warnings: z.array(z.string()).length(0),
}).strict().superRefine((batch, ctx) => {
  if (new Date(batch.observedAt).toISOString() !== batch.observedAt ||
      new Set(batch.offers.map(o => o.kind)).size !== 2 ||
      batch.offers.some(o => o.sourceUrl !== batch.sourceUrl || o.observedAt !== batch.observedAt ||
        o.key !== `hellfest-${batch.editionYear}-${o.kind}`)) {
    ctx.addIssue({ code: "custom", message: "Tier identity/time mismatch" });
  }
});

export const ticketOfferReviewSchema = z.object({
  id: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewState: z.enum(["pending", "approved", "rejected"]), proposal: hellfestProposalSchema,
}).strict();
export type TicketOfferReview = z.infer<typeof ticketOfferReviewSchema>;
