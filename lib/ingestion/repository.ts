import { overviewSourceUrls } from "./adapters/festival-overview.ts";
import { admissionSources } from "./adapters/admission-sources.ts";
import { TOLMINATOR_PRODUCT } from "./adapters/tolminator-stock.ts";
import { queueImportEvent } from "./import-event-queue.ts";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { INGESTION_SCHEMA_VERSION, type IngestionResult } from "./types.ts";

export const INGESTION_POLICY_VERSION = "2026-08-29";
export const MAX_EVIDENCE_EXCERPT = 2_000;

type Client = PrismaClient | Prisma.TransactionClient;
type AttemptInput = {
  runId: string;
  festivalSlug: string;
  requestedUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  durationMs: number;
  retryCount?: number;
  error?: string;
  startedAt: Date;
  endedAt: Date;
  result?: IngestionResult;
  sourceLease?: { id: string; owner: string; updatedAt: Date };
};

export async function createIngestionRun(
  db: Client,
  input: {
    trigger: "SCHEDULE" | "MANUAL" | "API" | "TEST";
    sourceCommit: string;
    totalSources: number;
  },
) {
  return db.ingestionRun.create({ data: { schemaVersion: INGESTION_SCHEMA_VERSION, ...input } });
}

// Only reviewed independent endpoints are excluded. Do not infer scope from
// caller-supplied candidate fields (a failed request has no candidate at all).
const independentTicketUrls = [TOLMINATOR_PRODUCT, ...admissionSources.map(({ url }) => url)];
export const isIndependentTicketUrl = (url: string) => independentTicketUrls.includes(url);
const attemptScope = (
  festivalSlug: string,
  requestedUrl?: string,
): Prisma.IngestionAttemptWhereInput =>
  requestedUrl
    ? { requestedUrl }
    : { requestedUrl: { notIn: [...independentTicketUrls, ...overviewSourceUrls(festivalSlug)] } };

export async function persistAttempt(db: PrismaClient, input: AttemptInput) {
  return db.$transaction(async (tx) => {
    const { arrival, overview } = input.result?.candidate ?? {};
    const organizer = arrival ?? overview;
    if (Boolean(input.sourceLease) !== Boolean(organizer))
      throw new Error("Organizer observations require a source lease");
    if (
      arrival &&
      overview &&
      (arrival.editionId !== overview.editionId ||
        arrival.editionYear !== overview.editionYear ||
        arrival.festivalSlug !== overview.festivalSlug)
    )
      throw new Error("Shared organizer observations must refer to the same edition");
    if (input.sourceLease) {
      const lease = input.sourceLease;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "FestivalSource"
        WHERE id = ${lease.id} AND "leaseOwner" = ${lease.owner}
          AND enabled = true AND "configurationBackfilledAt" IS NOT NULL
          AND "festivalSlug" = ${input.festivalSlug} AND url = ${input.requestedUrl}
          AND "editionId" = ${organizer?.editionId ?? null}
          AND "editionYear" = ${organizer?.editionYear ?? null}
          AND "updatedAt" = (${lease.updatedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        FOR UPDATE
      `;
      if (rows.length !== 1) throw new Error("Ingestion source lease is no longer active");
    }
    const result = input.result;
    const independent =
      isIndependentTicketUrl(input.requestedUrl) ||
      overviewSourceUrls(input.festivalSlug).includes(input.requestedUrl);
    const scope = attemptScope(input.festivalSlug, independent ? input.requestedUrl : undefined);
    const status = !result
      ? "FAILED"
      : result.reviewReasons.length
        ? "REVIEW"
        : result.publishable
          ? "PUBLISHABLE"
          : "UNCHANGED";
    const previous = await tx.ingestionAttempt.findFirst({
      where: { festivalSlug: input.festivalSlug, ...scope },
      orderBy: { endedAt: "desc" },
      select: { id: true },
    });
    const attempt = await tx.ingestionAttempt.create({
      data: {
        runId: input.runId,
        festivalSlug: input.festivalSlug,
        requestedUrl: input.requestedUrl,
        finalUrl: input.finalUrl,
        httpStatus: input.httpStatus,
        durationMs: input.durationMs,
        retryCount: input.retryCount ?? 0,
        error: input.error,
        parserVersions: { extractor: INGESTION_SCHEMA_VERSION },
        status,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        priorAttemptId: previous?.id,
      },
    });
    if (result) {
      const prior = await tx.ingestionCandidate.findFirst({
        where: { festivalSlug: input.festivalSlug, attempt: scope },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const candidate = await tx.ingestionCandidate.create({
        data: {
          runId: input.runId,
          attemptId: attempt.id,
          festivalSlug: input.festivalSlug,
          schemaVersion: result.schemaVersion,
          sourceEdition: result.candidate.startDate,
          sourceYear: result.candidate.startDate
            ? Number(result.candidate.startDate.slice(0, 4))
            : (result.candidate.arrival?.editionYear ?? result.candidate.overview?.editionYear),
          normalized: result.candidate as Prisma.InputJsonValue,
          warnings: result.candidate.warnings,
          publishable: result.publishable,
          supersedesId: prior?.id,
        },
      });
      if (result.candidate.evidence.length)
        await tx.ingestionEvidence.createMany({
          data: result.candidate.evidence.map((e) => ({
            candidateId: candidate.id,
            field: e.field,
            sourceUrl: e.sourceUrl,
            excerpt: e.excerpt?.slice(0, MAX_EVIDENCE_EXCERPT),
            contentHash:
              e.contentHash ??
              createHash("sha256")
                .update(e.excerpt ?? JSON.stringify(result.candidate[e.field] ?? null))
                .digest("hex"),
            observedValue: (result.candidate[e.field] ?? null) as Prisma.InputJsonValue,
            observedAt: new Date(e.observedAt),
            adapter: e.adapter ?? "festival-extractor-v1",
          })),
        });
      if (result.changes.length)
        await tx.ingestionDiff.createMany({
          data: result.changes.map((d) => ({
            candidateId: candidate.id,
            field: d.field,
            beforeValue: (d.before ?? null) as Prisma.InputJsonValue,
            afterValue: (d.after ?? null) as Prisma.InputJsonValue,
            reviewRequired: d.reviewRequired,
            policyVersion: INGESTION_POLICY_VERSION,
          })),
        });
    }
    if (result && !independent)
      await tx.ingestionSourceState.upsert({
        where: { festivalSlug: input.festivalSlug },
        create: {
          festivalSlug: input.festivalSlug,
          lastSuccessfulCheck: input.endedAt,
          lastAttemptId: attempt.id,
        },
        update: { lastSuccessfulCheck: input.endedAt, lastAttemptId: attempt.id },
      });
    const sources = await tx.festivalSource.findMany({
      where: { enabled: true, festivalSlug: input.festivalSlug, url: input.requestedUrl },
      select: { id: true },
    });
    for (const source of sources)
      await queueImportEvent(tx, attempt.id + "-" + source.id, {
        kind: "source",
        sourceId: source.id,
        attemptId: attempt.id,
      });
    return attempt;
  });
}

export async function finishIngestionRun(db: Client, runId: string) {
  const grouped = await db.ingestionAttempt.groupBy({
    by: ["status"],
    where: { runId },
    _count: true,
  });
  const counts = Object.fromEntries(grouped.map((x) => [x.status, x._count]));
  const successful = (counts.UNCHANGED ?? 0) + (counts.REVIEW ?? 0) + (counts.PUBLISHABLE ?? 0);
  return db.ingestionRun.update({
    where: { id: runId },
    data: {
      endedAt: new Date(),
      status: counts.FAILED ? (successful ? "PARTIAL" : "FAILED") : "COMPLETED",
      successful,
      unchanged: counts.UNCHANGED ?? 0,
      reviewRequired: counts.REVIEW ?? 0,
      publishable: counts.PUBLISHABLE ?? 0,
      failed: counts.FAILED ?? 0,
    },
  });
}

export const ingestionQueries = {
  runHistory: (db: Client, take = 50) =>
    db.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take, include: { attempts: true } }),
  latestResult: (db: Client, festivalSlug: string, requestedUrl?: string) =>
    db.ingestionAttempt.findFirst({
      where: { festivalSlug, ...attemptScope(festivalSlug, requestedUrl) },
      orderBy: { endedAt: "desc" },
      include: { candidate: { include: { evidence: true, diffs: true } } },
    }),
  candidateHistory: (db: Client, festivalSlug: string) =>
    db.ingestionCandidate.findMany({
      where: { festivalSlug },
      orderBy: { createdAt: "desc" },
      include: { evidence: true },
    }),
  diffHistory: (db: Client, festivalSlug: string) =>
    db.ingestionDiff.findMany({
      where: { candidate: { festivalSlug } },
      orderBy: { createdAt: "desc" },
    }),
  sourceStates: (db: Client) =>
    db.ingestionSourceState.findMany({ select: { festivalSlug: true, lastSuccessfulCheck: true } }),
  lastSuccessfulCheck: (db: Client, festivalSlug: string, requestedUrl: string) =>
    db.ingestionAttempt.findFirst({
      where: { festivalSlug, requestedUrl, status: { not: "FAILED" } },
      orderBy: { endedAt: "desc" },
      select: { endedAt: true },
    }),
  lastSuccessfulExtraction: (db: Client, festivalSlug: string, requestedUrl?: string) =>
    db.ingestionEvidence.findFirst({
      where: { candidate: { festivalSlug, attempt: attemptScope(festivalSlug, requestedUrl) } },
      orderBy: { observedAt: "desc" },
      select: { observedAt: true },
    }),
  consecutiveFailures: async (db: Client, festivalSlug: string, requestedUrl?: string) => {
    const attempts = await db.ingestionAttempt.findMany({
      where: { festivalSlug, ...attemptScope(festivalSlug, requestedUrl) },
      orderBy: { endedAt: "desc" },
      take: 100,
      select: { status: true },
    });
    return attempts.findIndex(({ status }) => status !== "FAILED") === -1
      ? attempts.length
      : attempts.findIndex(({ status }) => status !== "FAILED");
  },
};
