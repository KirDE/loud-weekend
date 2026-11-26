import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { fingerprint, ImportAgentError } from "./agent-contract.ts";
import { inspectSource } from "./agent-issues.ts";

export const sourceRecheckInput = z
  .object({
    operation: z.literal("source_recheck"),
    sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
    editionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
    editionYear: z.number().int().min(2000).max(2099),
    sourceUrl: z.string().url().max(2048),
    parserKey: z.string().min(1).max(200),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict();

/** Request one normal due-worker observation after a deployed parser repair.
 * No fetch, candidate approval, failure reset, catalog publication or provider work.
 * Existing issues must be resolved by their own capabilities, never superseded here.
 */
export async function requestSourceRecheck(db: PrismaClient, value: unknown) {
  const input = sourceRecheckInput.parse(value);
  if (input.commit !== process.env.DEPLOYED_COMMIT) throw new ImportAgentError("stale");
  const key = "source-recheck-" + fingerprint(input);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "FestivalSource" WHERE id=${input.sourceId} FOR UPDATE`;
      const source = await tx.festivalSource.findUnique({
        where: { id: input.sourceId },
        include: { edition: true },
      });
      if (
        !source ||
        !source.enabled ||
        source.deprecatedAt ||
        !source.configurationBackfilledAt ||
        source.editionId !== input.editionId ||
        source.editionYear !== input.editionYear ||
        source.parserKey !== input.parserKey ||
        (source.fetchUrl ?? source.url) !== input.sourceUrl ||
        source.edition?.recordState !== "CURRENT" ||
        source.edition.year !== input.editionYear ||
        source.edition.festivalId !== source.festivalId
      )
        throw new ImportAgentError("stale");
      const receipt = await tx.operationalState.findUnique({ where: { key } });
      if (receipt) return receipt.payload;
      const now = new Date();
      if (
        source.consecutiveFailures > 0 ||
        source.lastError ||
        (source.leaseExpiresAt && source.leaseExpiresAt > now) ||
        (await inspectSource(tx, source.id))
      )
        throw new ImportAgentError("busy");
      // Preserve all source configuration, history, backoff and candidate decisions.
      await tx.festivalSource.update({
        where: { id: source.id },
        data: {
          nextRunAt: now,
          httpEtag: null,
          httpLastModified: null,
        },
      });
      const payload = {
        requested: true,
        sourceId: source.id,
        editionId: input.editionId,
        editionYear: input.editionYear,
        commit: input.commit,
        requestedAt: now.toISOString(),
        providerJobs: 0,
        published: false,
      };
      await tx.operationalState.create({ data: { key, payload } });
      await tx.adminAuditEntry.create({
        data: {
          actorLabel: "OpenClaw source recheck",
          action: "ingestion.source.recheck_requested",
          resourceKind: "FESTIVAL",
          resourceKey: source.festivalSlug,
          metadata: payload,
        },
      });
      return payload;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
  );
}
