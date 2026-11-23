import { z } from "zod";
const sourceUrl = z.url({ protocol: /^https$/ });
const iso = z.string().datetime({ precision: 3 });
const offer = z.object({
  key: z.string(), kind: z.enum(["full_pass", "day_pass"]), label: z.string().min(1).max(80),
  status: z.enum(["sold_out", "not_on_sale", "unknown"]),
  price: z.object({ amountMinor: z.number().int().min(0).max(9_999_999), currency: z.literal("EUR"), fees: z.literal("unknown") }).strict().nullable(),
  saleDateText: z.string().min(1).max(120).nullable(), sourceUrl, observedAt: iso,
  excerpt: z.string().min(1).max(500),
}).strict();
export const ticketOfferProposalSchema = z.object({
  festivalSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), editionYear: z.number().int().min(2000).max(2100),
  sourceUrl, observedAt: iso, offers: z.array(offer).length(2), warnings: z.array(z.string()).length(0),
}).strict().superRefine((batch, ctx) => {
  if (new Date(batch.observedAt).toISOString() !== batch.observedAt ||
      new Set(batch.offers.map(o => o.kind)).size !== 2 ||
      batch.offers.some(o => o.sourceUrl !== batch.sourceUrl || o.observedAt !== batch.observedAt ||
        o.key !== `${batch.festivalSlug}-${batch.editionYear}-${o.kind}`)) {
    ctx.addIssue({ code: "custom", message: "Tier identity/time mismatch" });
  }
});

export const ticketOfferReviewSchema = z.object({
  id: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewState: z.enum(["pending", "approved", "rejected"]), proposal: ticketOfferProposalSchema,
}).strict();
export type TicketOfferReview = z.infer<typeof ticketOfferReviewSchema>;
