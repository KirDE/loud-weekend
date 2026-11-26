import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  lifecycleProposalSchema as schema,
  publicEditionLifecycleSchema,
} from "../domain/edition-lifecycle-review.ts";
import { lifecycleSource } from "./lifecycle-sources.ts";

const digest = (editionId: string, value: z.infer<typeof schema>, version: string) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        editionId,
        parserVersion: version,
        sourceUrl: value.sourceUrl,
        finalUrl: value.sourceUrl,
        httpStatus: 200,
        proposal: value,
      }),
    )
    .digest("hex");
const fresh = (at: Date) => {
  const age = Date.now() - at.getTime();
  return age >= -60_000 && age <= 86_400_000;
};
type Target = {
  year: number;
  recordState: string;
  festival: { slug: string; officialUrl: string };
};
function validateTarget(edition: Target, proposal: z.infer<typeof schema>) {
  if (
    edition.year !== proposal.editionYear ||
    edition.recordState !== "CURRENT" ||
    edition.festival.slug !== proposal.festivalSlug ||
    edition.festival.officialUrl !== proposal.sourceUrl
  ) {
    throw new Error("Lifecycle target identity mismatch");
  }
}
type Snapshot = Awaited<
  ReturnType<PrismaClient["editionLifecycleProposalSnapshot"]["findFirstOrThrow"]>
>;
function validateSnapshot(row: Snapshot) {
  const proposal = schema.parse(row.proposal);
  const source = lifecycleSource(row.parserVersion);
  source.validate(proposal);
  if (
    row.sourceUrl !== source.sourceUrl ||
    row.finalUrl !== source.sourceUrl ||
    row.httpStatus !== 200 ||
    proposal.observedAt !== row.observedAt.toISOString() ||
    row.contentHash !== digest(row.editionId, proposal, row.parserVersion)
  )
    throw new Error("Persisted lifecycle proof mismatch");
  return proposal;
}

/** Internal staging only: re-extract source response, never accept caller-built
 * lifecycle assertions. No canonical write, approval, health refresh or jobs. */
export async function stageEditionLifecycle(
  db: PrismaClient,
  input: {
    parserVersion: string;
    editionId: string;
    html: string;
    requestedUrl: string;
    finalUrl: string;
    status: number;
    observedAt: string;
  },
) {
  const source = lifecycleSource(input.parserVersion);
  if (input.requestedUrl !== source.sourceUrl)
    throw new Error("Lifecycle requested route mismatch");
  const proposal = schema.parse(source.observe(input.html, input.observedAt, input));
  const observedAt = new Date(proposal.observedAt);
  if (!fresh(observedAt)) throw new Error("Expired or future lifecycle observation");
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${input.editionId} FOR UPDATE`;
    if (locked.length !== 1) throw new Error("Unknown lifecycle target");
    const edition = await tx.festivalEdition.findUniqueOrThrow({
      where: { id: input.editionId },
      include: { festival: true },
    });
    validateTarget(edition, proposal);
    if (!fresh(observedAt)) throw new Error("Expired or future lifecycle observation");
    const contentHash = digest(edition.id, proposal, source.parserVersion);
    const prior = await tx.editionLifecycleProposalSnapshot.findFirst({
      where: { editionId: edition.id },
      orderBy: { observedAt: "desc" },
    });
    if (prior) {
      validateSnapshot(prior); // Corrupt latest evidence must not silently fall back.
      if (observedAt.getTime() <= prior.observedAt.getTime()) {
        if (
          observedAt.getTime() === prior.observedAt.getTime() &&
          prior.contentHash === contentHash
        )
          return prior;
        throw new Error("Stale or conflicting lifecycle observation");
      }
    }
    return tx.editionLifecycleProposalSnapshot.create({
      data: {
        editionId: edition.id,
        sourceUrl: source.sourceUrl,
        finalUrl: input.finalUrl,
        httpStatus: input.status,
        observedAt,
        parserVersion: source.parserVersion,
        contentHash,
        proposal: proposal as Prisma.InputJsonValue,
      },
    });
  });
}

/** INTERNAL reviewer read, not a public lifecycle. Reports an audited decision
 * when present; historical or already-decided evidence is ineligible for review. */
export async function readPendingEditionLifecycle(db: PrismaClient, editionId: string) {
  const row = await db.editionLifecycleProposalSnapshot.findFirst({
    where: { editionId },
    orderBy: { observedAt: "desc" },
    include: { edition: { include: { festival: true } } },
  });
  if (!row) return null;
  const proposal = validateSnapshot(row);
  validateTarget(row.edition, proposal);
  const decision = await db.editionLifecycleReviewDecision.findUnique({
    where: { snapshotId: row.id },
    include: { audit: true },
  });
  if (decision) validateDecision(row, decision);
  return {
    id: row.id,
    contentHash: row.contentHash,
    reviewState: decision ? (decision.decision === "approve" ? "approved" : "rejected") : "pending",
    eligibleForReview: !decision && fresh(row.observedAt),
    proposal,
  };
}

type Decision = Prisma.EditionLifecycleReviewDecisionGetPayload<{ include: { audit: true } }>;
function validateDecision(row: Snapshot, value: Decision) {
  const audit = value.audit;
  const action =
    value.decision === "approve" ? "EDITION_LIFECYCLE_APPROVED" : "EDITION_LIFECYCLE_REJECTED";
  if (
    !["approve", "reject"].includes(value.decision) ||
    value.snapshotId !== row.id ||
    value.contentHash !== row.contentHash ||
    audit.actorId !== value.actorId ||
    audit.actorLabel !== value.actorId ||
    audit.action !== action ||
    audit.resourceKind !== "FESTIVAL" ||
    audit.resourceKey !== schema.parse(row.proposal).festivalSlug ||
    audit.target !== row.id ||
    !auditEvidenceSchema.safeParse(audit.evidence).success ||
    Object.entries(evidence(row)).some(
      ([key, v]) => (audit.evidence as Record<string, unknown>)[key] !== v,
    )
  ) {
    throw new Error("Persisted lifecycle decision audit mismatch");
  }
}
const auditEvidenceSchema = z
  .object({
    contentHash: z.string(),
    sourceUrl: z.string(),
    observedAt: z.string(),
    editionId: z.string(),
  })
  .strict();
function evidence(row: Snapshot) {
  return {
    contentHash: row.contentHash,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt.toISOString(),
    editionId: row.editionId,
  };
}

/** INTERNAL boundary, not an authenticated endpoint. actorId MUST come from a
 * validated session, never the request body. Rechecks role/allowlist under lock.
 * Decision+immutable admin audit commit atomically; no catalogue or public write. */
export async function decideEditionLifecycle(
  db: PrismaClient,
  input: {
    snapshotId: string;
    expectedContentHash: string;
    decision: "approve" | "reject";
    actorId: string;
  },
) {
  if (
    !["approve", "reject"].includes(input.decision) ||
    !/^[a-f0-9]{64}$/.test(input.expectedContentHash)
  ) {
    throw new Error("Invalid lifecycle decision or revision");
  }
  return db.$transaction(async (tx) => {
    // Shared lock prevents concurrent role revocation from crossing this decision.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.actorId} FOR SHARE`;
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
      throw new Error("Authorized lifecycle reviewer required");
    }
    const initial = await tx.editionLifecycleProposalSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
    });
    await tx.$queryRaw`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${initial.editionId} FOR UPDATE`;
    const row = await tx.editionLifecycleProposalSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
      include: { edition: { include: { festival: true } } },
    });
    validateTarget(row.edition, validateSnapshot(row));
    if (row.contentHash !== input.expectedContentHash)
      throw new Error("Lifecycle revision conflict");
    const prior = await tx.editionLifecycleReviewDecision.findUnique({
      where: { snapshotId: row.id },
      include: { audit: true },
    });
    if (prior) {
      validateDecision(row, prior);
      if (prior.decision === input.decision && prior.actorId === actor.id) return prior;
      throw new Error("Lifecycle snapshot already decided");
    }
    const latest = await tx.editionLifecycleProposalSnapshot.findFirstOrThrow({
      where: { editionId: row.editionId },
      orderBy: { observedAt: "desc" },
    });
    if (latest.id !== row.id || !fresh(row.observedAt))
      throw new Error("Superseded or expired lifecycle proposal");
    const audit = await tx.adminAuditEntry.create({
      data: {
        actorId: actor.id,
        actorLabel: actor.id,
        action:
          input.decision === "approve"
            ? "EDITION_LIFECYCLE_APPROVED"
            : "EDITION_LIFECYCLE_REJECTED",
        resourceKind: "FESTIVAL",
        resourceKey: schema.parse(row.proposal).festivalSlug,
        target: row.id,
        evidence: evidence(row),
      },
    });
    return tx.editionLifecycleReviewDecision.create({
      data: {
        snapshotId: row.id,
        contentHash: row.contentHash,
        decision: input.decision,
        actorId: actor.id,
        auditId: audit.id,
      },
      include: { audit: true },
    });
  });
}

/** Approved-only minimal public projection, not a catalogue mutation. New pending
 * or rejected observations do not inherit approval or erase the last approved
 * notice. The approved observation/audit times remain unchanged (no restamp).
 * Lifecycle facts remain historical after 24h; only new decisions require fresh
 * evidence. Unknown is null, never an inferred active edition. Any corrupt latest
 * or approved proof throws rather than presenting an older healthy fallback.
 * Not wired to the catalogue until all public CTA/SEO consumers honour hiatus. */
export async function readApprovedEditionLifecycle(db: PrismaClient, editionId: string) {
  return db.$transaction((tx) => readApprovedEditionLifecycleInSnapshot(tx, editionId), {
    isolationLevel: "RepeatableRead",
  });
}

/** Compose with another public projection in the caller's RepeatableRead snapshot. */
export async function readApprovedEditionLifecycleInSnapshot(
  tx: Pick<Prisma.TransactionClient, "editionLifecycleProposalSnapshot">,
  editionId: string,
) {
  const latest = await tx.editionLifecycleProposalSnapshot.findFirst({
    where: { editionId },
    orderBy: { observedAt: "desc" },
    include: { edition: { include: { festival: true } }, decision: { include: { audit: true } } },
  });
  if (!latest) return null;
  validateTarget(latest.edition, validateSnapshot(latest));
  if (latest.decision) validateDecision(latest, latest.decision);
  const approved = await tx.editionLifecycleProposalSnapshot.findFirst({
    // Include immutable approval audits as well: mutating a decision to
    // "reject" must not silently hide that approval and revive an older one.
    where: {
      editionId,
      OR: [
        { decision: { decision: "approve" } },
        { decision: { audit: { action: "EDITION_LIFECYCLE_APPROVED" } } },
      ],
    },
    orderBy: { observedAt: "desc" },
    include: { decision: { include: { audit: true } } },
  });
  if (!approved) return null;
  const proposal = validateSnapshot(approved);
  if (!approved.decision) throw new Error("Missing approved lifecycle audit");
  validateDecision(approved, approved.decision);
  return publicEditionLifecycleSchema.parse({
    festivalSlug: proposal.festivalSlug,
    editionYear: proposal.editionYear,
    lifecycle: proposal.lifecycle,
    announcedReturnYear: proposal.announcedReturnYear,
    alternativeEvent: proposal.alternativeEvent,
    sourceUrl: proposal.sourceUrl,
    observedAt: proposal.observedAt,
    approvedAt: approved.decision.audit.createdAt.toISOString(),
  });
}
