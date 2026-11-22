import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { observeRockEnSeineHiatus, ROCK_EN_SEINE_HOME } from "./adapters/rock-en-seine-hiatus.ts";

const version = "rock-en-seine-hiatus-v1";
const schema = z.object({
  festivalSlug: z.literal("rock-en-seine"), editionYear: z.literal(2027),
  lifecycle: z.literal("hiatus"), announcedReturnYear: z.literal(2028),
  alternativeEvent: z.literal("under_consideration"), sourceUrl: z.literal(ROCK_EN_SEINE_HOME),
  observedAt: z.iso.datetime({ precision: 3 }),
  excerpt: z.literal("Rock en Seine: festival pauses in 2027 and announces a return in 2028. A different 2027 event is only under consideration, not confirmed. No ordinary 2027 ticket inventory assertion."),
}).strict();
const digest = (editionId: string, value: z.infer<typeof schema>) => createHash("sha256")
  .update(JSON.stringify({ editionId, parserVersion: version, sourceUrl: ROCK_EN_SEINE_HOME,
    finalUrl: ROCK_EN_SEINE_HOME, httpStatus: 200, proposal: value })).digest("hex");
const fresh = (at: Date) => { const age = Date.now() - at.getTime(); return age >= -60_000 && age <= 86_400_000; };
type Target = { year: number; recordState: string; festival: { slug: string; officialUrl: string } };
function validateTarget(edition: Target) {
  if (edition.year !== 2027 || edition.recordState !== "CURRENT" || edition.festival.slug !== "rock-en-seine"
    || edition.festival.officialUrl !== ROCK_EN_SEINE_HOME) throw new Error("Lifecycle target identity mismatch");
}
type Snapshot = Awaited<ReturnType<PrismaClient["editionLifecycleProposalSnapshot"]["findFirstOrThrow"]>>;
function validateSnapshot(row: Snapshot) {
  const proposal = schema.parse(row.proposal);
  if (row.sourceUrl !== ROCK_EN_SEINE_HOME || row.finalUrl !== ROCK_EN_SEINE_HOME || row.httpStatus !== 200
    || row.parserVersion !== version || proposal.observedAt !== row.observedAt.toISOString()
    || row.contentHash !== digest(row.editionId, proposal)) throw new Error("Persisted lifecycle proof mismatch");
  return proposal;
}

/** Internal staging only: re-extract source response, never accept caller-built
 * lifecycle assertions. No canonical write, approval, health refresh or jobs. */
export async function stageRockEnSeineHiatus(db: PrismaClient, input: {
  editionId: string; html: string; requestedUrl: string; finalUrl: string; status: number; observedAt: string;
}) {
  if (input.requestedUrl !== ROCK_EN_SEINE_HOME) throw new Error("Lifecycle requested route mismatch");
  const proposal = schema.parse(observeRockEnSeineHiatus(input.html, input.observedAt, input));
  const observedAt = new Date(proposal.observedAt);
  if (!fresh(observedAt)) throw new Error("Expired or future lifecycle observation");
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FestivalEdition" WHERE "id" = ${input.editionId} FOR UPDATE`;
    if (locked.length !== 1) throw new Error("Unknown lifecycle target");
    const edition = await tx.festivalEdition.findUniqueOrThrow({ where: { id: input.editionId }, include: { festival: true } });
    validateTarget(edition);
    if (!fresh(observedAt)) throw new Error("Expired or future lifecycle observation");
    const contentHash = digest(edition.id, proposal);
    const prior = await tx.editionLifecycleProposalSnapshot.findFirst({ where: { editionId: edition.id }, orderBy: { observedAt: "desc" } });
    if (prior) {
      validateSnapshot(prior); // Corrupt latest evidence must not silently fall back.
      if (observedAt.getTime() <= prior.observedAt.getTime()) {
        if (observedAt.getTime() === prior.observedAt.getTime() && prior.contentHash === contentHash) return prior;
        throw new Error("Stale or conflicting lifecycle observation");
      }
    }
    return tx.editionLifecycleProposalSnapshot.create({ data: {
      editionId: edition.id, sourceUrl: ROCK_EN_SEINE_HOME, finalUrl: input.finalUrl, httpStatus: input.status,
      observedAt, parserVersion: version, contentHash, proposal: proposal as Prisma.InputJsonValue,
    } });
  });
}

/** REVIEWER-only pending read. Not an approved/public lifecycle. Expired evidence
 * remains visible as historical evidence, explicitly ineligible for review. */
export async function readPendingRockEnSeineHiatus(db: PrismaClient, editionId: string) {
  const row = await db.editionLifecycleProposalSnapshot.findFirst({ where: { editionId }, orderBy: { observedAt: "desc" },
    include: { edition: { include: { festival: true } } } });
  if (!row) return null;
  validateTarget(row.edition);
  return { id: row.id, contentHash: row.contentHash, reviewState: "pending" as const,
    eligibleForReview: fresh(row.observedAt), proposal: validateSnapshot(row) };
}
