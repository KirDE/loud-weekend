import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { extractHellfestOfferProposals } from "./adapters/hellfest-offers.ts";

const sourceUrl = "https://hellfest.fr/";
const version = "hellfest-offer-proposals-v1";
const iso = z.string().datetime({ precision: 3 });
const offer = z.object({
  key: z.string(), kind: z.enum(["full_pass", "day_pass"]), label: z.string().min(1).max(80),
  status: z.enum(["sold_out", "not_on_sale", "unknown"]),
  price: z.object({ amountMinor: z.number().int().min(0).max(9_999_999), currency: z.literal("EUR"), fees: z.literal("unknown") }).strict().nullable(),
  saleDateText: z.string().min(1).max(120).nullable(), sourceUrl: z.literal(sourceUrl), observedAt: iso,
  excerpt: z.string().min(1).max(500),
}).strict();
const schema = z.object({
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
const digest = (value: z.infer<typeof schema>) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Durable REVIEW ONLY staging. No catalog writes, source health refresh,
 * publication, notification or provider work. Never accepts caller-built offers:
 * re-extract from the bounded response before persisting an immutable snapshot.
 */
export async function stageHellfestOffers(db: PrismaClient, input: {
  editionId: string; html: string; finalUrl: string; status: number; observedAt: string;
}) {
  return db.$transaction(async tx => {
    // Serialize competing observations, including an initially empty history.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${input.editionId} FOR UPDATE`;
    if (locked.length !== 1) throw new Error("Unknown target edition");
    const edition = await tx.festivalEdition.findUniqueOrThrow({ where: { id: input.editionId }, include: { festival: true } });
    if (edition.festival.slug !== "hellfest" || edition.recordState !== "CURRENT" || edition.festival.officialUrl !== sourceUrl) {
      throw new Error("Hellfest target identity mismatch");
    }
    const value = schema.parse(extractHellfestOfferProposals({ ...input, editionYear: edition.year }));
    const observedAt = new Date(value.observedAt);
    const age = Date.now() - observedAt.getTime();
    if (age < -60_000 || age > 24 * 60 * 60_000) throw new Error("Stale or future observation");
    const contentHash = digest(value);
    const prior = await tx.ticketOfferProposalSnapshot.findFirst({ where: { editionId: edition.id }, orderBy: { observedAt: "desc" } });
    if (prior) {
      const saved = schema.parse(prior.proposal);
      if (prior.sourceUrl !== sourceUrl || prior.parserVersion !== version || saved.editionYear !== edition.year ||
          saved.observedAt !== prior.observedAt.toISOString() || digest(saved) !== prior.contentHash) {
        throw new Error("Persisted tier proposal proof mismatch");
      }
    }
    if (prior && observedAt.getTime() <= prior.observedAt.getTime()) {
      if (observedAt.getTime() === prior.observedAt.getTime() && prior.contentHash === contentHash && prior.parserVersion === version) return prior;
      throw new Error("Stale or conflicting tier observation");
    }
    return tx.ticketOfferProposalSnapshot.create({ data: {
      editionId: edition.id, sourceUrl, observedAt, contentHash, parserVersion: version,
      proposal: value as Prisma.InputJsonValue,
    } });
  });
}

/** Reviewer readback only; not a canonical public inventory reader. Never falls
 * back to older data when the latest stored snapshot fails proof validation. */
export async function readPendingHellfestOffers(db: PrismaClient, editionId: string) {
  const row = await db.ticketOfferProposalSnapshot.findFirst({ where: { editionId }, orderBy: { observedAt: "desc" }, include: { edition: { include: { festival: true } } } });
  if (!row) return null;
  const value = schema.parse(row.proposal);
  if (row.parserVersion !== version || row.sourceUrl !== sourceUrl || row.edition.festival.slug !== value.festivalSlug ||
      row.edition.festival.officialUrl !== sourceUrl || row.edition.recordState !== "CURRENT" ||
      row.edition.year !== value.editionYear || row.observedAt.toISOString() !== value.observedAt || digest(value) !== row.contentHash) {
    throw new Error("Persisted tier proposal proof mismatch");
  }
  return { id: row.id, reviewState: "pending" as const, proposal: value };
}
