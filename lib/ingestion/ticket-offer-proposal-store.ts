import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { ticketOfferProposalSchema as schema } from "../domain/ticket-offer-review.ts";
import {
  extractHellfestOfferProposals,
  HELLFEST_OFFER_SOURCE as sourceUrl,
  HELLFEST_OFFER_PARSER as version,
  isHellfestOfferTarget,
} from "./adapters/hellfest-offers.ts";

const digest = (value: z.infer<typeof schema>) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Durable REVIEW ONLY staging. No catalog writes, source health refresh,
 * publication, notification or provider work. Never accepts caller-built offers:
 * re-extract from the bounded response before persisting an immutable snapshot.
 */
export async function stageHellfestOffers(
  db: PrismaClient,
  input: {
    editionId: string;
    html: string;
    finalUrl: string;
    status: number;
    observedAt: string;
  },
) {
  return db.$transaction(async (tx) => {
    // Serialize competing observations, including an initially empty history.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${input.editionId} FOR UPDATE`;
    if (locked.length !== 1) throw new Error("Unknown target edition");
    const edition = await tx.festivalEdition.findUniqueOrThrow({
      where: { id: input.editionId },
      include: { festival: true },
    });
    if (
      edition.recordState !== "CURRENT" ||
      !isHellfestOfferTarget(edition.festival.slug, edition.festival.officialUrl)
    ) {
      throw new Error("Hellfest target identity mismatch");
    }
    const value = schema.parse(
      extractHellfestOfferProposals({ ...input, editionYear: edition.year }),
    );
    const observedAt = new Date(value.observedAt);
    const age = Date.now() - observedAt.getTime();
    if (age < -60_000 || age > 24 * 60 * 60_000) throw new Error("Stale or future observation");
    const contentHash = digest(value);
    const prior = await tx.ticketOfferProposalSnapshot.findFirst({
      where: { editionId: edition.id },
      orderBy: { observedAt: "desc" },
    });
    if (prior) {
      const saved = schema.parse(prior.proposal);
      if (
        prior.sourceUrl !== sourceUrl ||
        prior.parserVersion !== version ||
        saved.editionYear !== edition.year ||
        saved.festivalSlug !== edition.festival.slug ||
        saved.sourceUrl !== sourceUrl ||
        saved.observedAt !== prior.observedAt.toISOString() ||
        digest(saved) !== prior.contentHash
      ) {
        throw new Error("Persisted tier proposal proof mismatch");
      }
    }
    if (prior && observedAt.getTime() <= prior.observedAt.getTime()) {
      if (
        observedAt.getTime() === prior.observedAt.getTime() &&
        prior.contentHash === contentHash &&
        prior.parserVersion === version
      )
        return prior;
      throw new Error("Stale or conflicting tier observation");
    }
    return tx.ticketOfferProposalSnapshot.create({
      data: {
        editionId: edition.id,
        sourceUrl,
        observedAt,
        contentHash,
        parserVersion: version,
        proposal: value as Prisma.InputJsonValue,
      },
    });
  });
}

/** Reviewer readback only; not a canonical public inventory reader. Never falls
 * back to older data when the latest stored snapshot fails proof validation. */
export async function readPendingHellfestOffers(db: PrismaClient, editionId: string) {
  const row = await db.ticketOfferProposalSnapshot.findFirst({
    where: { editionId },
    orderBy: { observedAt: "desc" },
    include: { edition: { include: { festival: true } } },
  });
  if (!row) return null;
  const proposal = validateSnapshot(row);
  const decision = await db.ticketOfferReviewDecision.findUnique({ where: { snapshotId: row.id } });
  if (
    decision &&
    (decision.contentHash !== row.contentHash || !["approve", "reject"].includes(decision.decision))
  ) {
    throw new Error("Persisted tier decision proof mismatch");
  }
  return {
    id: row.id,
    contentHash: row.contentHash,
    reviewState: decision ? (decision.decision === "approve" ? "approved" : "rejected") : "pending",
    proposal,
  };
}

function validateSnapshot(
  row: Awaited<ReturnType<PrismaClient["ticketOfferProposalSnapshot"]["findFirstOrThrow"]>> & {
    edition: {
      year: number;
      recordState: string;
      festival: { slug: string; officialUrl: string | null };
    };
  },
) {
  const value = schema.parse(row.proposal);
  if (
    row.parserVersion !== version ||
    row.sourceUrl !== sourceUrl ||
    row.edition.festival.slug !== value.festivalSlug ||
    value.sourceUrl !== row.sourceUrl ||
    !isHellfestOfferTarget(value.festivalSlug, row.edition.festival.officialUrl) ||
    row.edition.recordState !== "CURRENT" ||
    row.edition.year !== value.editionYear ||
    row.observedAt.toISOString() !== value.observedAt ||
    digest(value) !== row.contentHash
  ) {
    throw new Error("Persisted tier proposal proof mismatch");
  }
  return value;
}

/** Internal service boundary only. The HTTP caller MUST supply a
 * session-derived actorId after origin/auth checks, never a request-body actor.
 * Rechecks persisted role + the existing administrator email allowlist.
 */
export async function decideHellfestOffers(
  db: PrismaClient,
  input: {
    snapshotId: string;
    expectedContentHash: string;
    decision: "approve" | "reject";
    actorId: string;
  },
) {
  if (!["approve", "reject"].includes(input.decision)) throw new Error("Invalid tier decision");
  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId } });
    const allowed = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (
      !actor ||
      !["ADMIN", "EDITOR"].includes(actor.role) ||
      !allowed.includes(actor.email.toLowerCase())
    ) {
      throw new Error("Authorized tier reviewer required");
    }
    const initial = await tx.ticketOfferProposalSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
    });
    await tx.$queryRaw`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${initial.editionId} FOR UPDATE`;
    const row = await tx.ticketOfferProposalSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
      include: { edition: { include: { festival: true } } },
    });
    const proposal = validateSnapshot(row);
    if (row.contentHash !== input.expectedContentHash)
      throw new Error("Tier review revision conflict");
    const prior = await tx.ticketOfferReviewDecision.findUnique({ where: { snapshotId: row.id } });
    if (prior) {
      if (
        prior.contentHash === row.contentHash &&
        prior.decision === input.decision &&
        prior.actorId === actor.id
      )
        return prior;
      throw new Error("Tier snapshot already decided");
    }
    const latest = await tx.ticketOfferProposalSnapshot.findFirstOrThrow({
      where: { editionId: row.editionId },
      orderBy: { observedAt: "desc" },
    });
    if (latest.id !== row.id) throw new Error("Superseded tier proposal");
    const age = Date.now() - row.observedAt.getTime();
    if (age < -60_000 || age > 86_400_000) throw new Error("Expired tier proposal");
    const result = await tx.ticketOfferReviewDecision.create({
      data: {
        snapshotId: row.id,
        contentHash: row.contentHash,
        decision: input.decision,
        actorId: actor.id,
      },
    });
    await tx.adminAuditEntry.create({
      data: {
        actorId: actor.id,
        actorLabel: actor.id,
        action: input.decision === "approve" ? "TICKET_OFFERS_APPROVED" : "TICKET_OFFERS_REJECTED",
        resourceKind: "FESTIVAL",
        resourceKey: proposal.festivalSlug,
        target: row.id,
        evidence: {
          contentHash: row.contentHash,
          sourceUrl: row.sourceUrl,
          observedAt: row.observedAt.toISOString(),
        },
        metadata: { decisionId: result.id, editionId: row.editionId },
      },
    });
    return result;
  });
}

/** Approved tiers only, with fresh source-backed proof. New pending/rejected
 * observations cannot overwrite this selection. No fallback if approved proof
 * is corrupt; expired approval is not current inventory and returns null.
 * This does not publish/flatten FestivalEdition.ticketStatus or emit notifications.
 */
export async function readApprovedHellfestOffers(db: PrismaClient, editionId: string) {
  const row = await db.ticketOfferProposalSnapshot.findFirst({
    where: { editionId, decision: { is: { decision: "approve" } } },
    orderBy: { observedAt: "desc" },
    include: { decision: true, edition: { include: { festival: true } } },
  });
  return row ? projectApprovedOffer(row) : null;
}

/** Load the latest approved proposal only for the requested current editions. */
export async function readApprovedTicketOffers(db: PrismaClient, editionIds: string[]) {
  if (!editionIds.length) return [];
  const rows = await db.ticketOfferProposalSnapshot.findMany({
    where: {
      editionId: { in: editionIds },
      edition: { recordState: "CURRENT" },
      decision: { is: { decision: "approve" } },
    },
    distinct: ["editionId"],
    orderBy: { observedAt: "desc" },
    include: { decision: true, edition: { include: { festival: true } } },
  });
  return rows.flatMap((row) => {
    const approved = projectApprovedOffer(row);
    return approved ? [{ editionId: row.editionId, proposal: approved.proposal }] : [];
  });
}

function projectApprovedOffer(
  row: Parameters<typeof validateSnapshot>[0] & {
    decision: { contentHash: string; createdAt: Date } | null;
  },
) {
  const proposal = validateSnapshot(row);
  if (!row.decision || row.decision.contentHash !== row.contentHash)
    throw new Error("Persisted tier decision proof mismatch");
  const age = Date.now() - row.observedAt.getTime();
  if (age < -60_000 || age > 86_400_000) return null;
  return { id: row.id, approvedAt: row.decision.createdAt.toISOString(), proposal };
}
