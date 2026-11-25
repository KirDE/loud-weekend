import type { Prisma, PrismaClient } from "@prisma/client";
import { isPlaylistRefreshFailure } from "./playlist-failure";
import { requestedProviders, type PlaylistProvider } from "./playlist-provider-scope";

type Row = {
  provider: PlaylistProvider;
  jobId: string;
  evidence: Prisma.JsonValue;
  state: Prisma.JsonValue;
  stateUpdatedAt: Date;
  syncedAt: Date | null;
};

export type PlaylistRefreshFailures = Partial<Record<"spotify" | "youtubeMusic", true>>;

export async function getPlaylistRefreshFailures(
  slug: string,
  year: number,
  database?: PrismaClient,
): Promise<PlaylistRefreshFailures> {
  const client = database ?? (await import("../db")).db;
  const rows = await client.$queryRaw<Row[]>`
    SELECT providers.provider, current_job.id AS "jobId", current_job.evidence,
      s.payload AS state, s."updatedAt" AS "stateUpdatedAt", playlist."syncedAt"
    FROM (VALUES ('spotify'), ('youtube_music')) AS providers(provider)
    JOIN "Festival" f ON f.slug = ${slug}
    JOIN "FestivalEdition" e ON e."festivalId" = f.id AND e.year = ${year} AND e."recordState" = 'CURRENT'
    CROSS JOIN LATERAL (
      SELECT j.id, p.evidence
      FROM "CatalogPublication" p
      JOIN "CatalogPlaylistRefresh" j ON j."publicationId" = p.id AND j."festivalSlug" = f.slug
      WHERE p."festivalSlug" = f.slug AND p."editionYear" = e.year AND p."lineupChanged" = true
        AND (p.evidence IS NULL OR NOT (p.evidence ? 'providers')
          OR jsonb_typeof(p.evidence->'providers') <> 'array'
          OR (p.evidence->'providers') ? providers.provider)
      ORDER BY p."createdAt" DESC, j.id DESC
      LIMIT 1
    ) current_job
    JOIN "OperationalState" s ON s.key = 'playlist-provider:v1:' || providers.provider || ':' || current_job.id
    LEFT JOIN "FestivalPlaylist" playlist ON playlist."editionId" = e.id AND playlist.provider = providers.provider
  `;
  const failures: PlaylistRefreshFailures = {};
  for (const row of rows) {
    if (isConfirmedFailure(row))
      failures[row.provider === "spotify" ? "spotify" : "youtubeMusic"] = true;
  }
  return failures;
}

function isConfirmedFailure({ provider, jobId, evidence, state, stateUpdatedAt, syncedAt }: Row) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  try {
    if (!requestedProviders(evidence).includes(provider)) return false;
  } catch {
    return false;
  }
  return (
    state.version === 1 &&
    state.provider === provider &&
    state.jobId === jobId &&
    (state.status === "FAILED" || state.status === "BLOCKED") &&
    typeof state.attempts === "number" &&
    Number.isSafeInteger(state.attempts) &&
    state.attempts > 0 &&
    isPlaylistRefreshFailure(state.diagnostic) &&
    (!syncedAt || stateUpdatedAt >= syncedAt)
  );
}
