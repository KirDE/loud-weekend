import type { PrismaClient } from "@prisma/client";

export function latestDate(values: Iterable<string | undefined>): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    if (value && (!latest || value > latest)) latest = value;
  }
  return latest;
}

type SourceCheck = {
  editionId: string;
  checkedAt: Date | null;
  stale: boolean;
};

export async function readFreshnessEvidence(db: PrismaClient, now: Date) {
  const [publications, checks] = await Promise.all([
    db.catalogPublication.groupBy({
      by: ["festivalSlug", "editionYear"],
      _max: { createdAt: true },
      where: { createdAt: { lte: now } },
    }),
    // Lease success also covers review-only and empty extractions. Require a
    // real HTTP attempt with persisted, unambiguous evidence for this edition.
    db.$queryRaw<SourceCheck[]>`
      SELECT e.id AS "editionId", verified."checkedAt",
             (s."consecutiveFailures" > 0 OR s."deprecatedAt" IS NOT NULL OR
              COALESCE(verified."checkedAt" + make_interval(secs => s."cadenceSeconds")
                       <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'), false)) AS stale
      FROM "FestivalSource" s
      JOIN "FestivalEdition" e ON e.id = s."editionId" AND e.year = s."editionYear"
      JOIN "Festival" f ON f.id = e."festivalId"
                       AND f.id = s."festivalId" AND f.slug = s."festivalSlug"
      LEFT JOIN LATERAL (
        SELECT a."endedAt" AS "checkedAt"
        FROM "IngestionAttempt" a
        JOIN "IngestionCandidate" c ON c."attemptId" = a.id AND c."festivalSlug" = f.slug
        WHERE a."festivalSlug" = f.slug AND a."requestedUrl" = s.url
          AND a."endedAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND a."httpStatus" BETWEEN 200 AND 299
          AND a.status IN ('UNCHANGED', 'PUBLISHABLE') AND c."reviewState" <> 'REJECTED'
          AND c.normalized->'observedEditionYears' = jsonb_build_array(e.year)
          AND EXISTS (
            SELECT 1 FROM "IngestionEvidence" ev
            WHERE ev."candidateId" = c.id AND ev."observedAt" <= a."endedAt"
          )
        ORDER BY a."endedAt" DESC
        LIMIT 1
      ) verified ON true
      WHERE s.enabled AND s."refreshPolicy" <> 'archived' AND e."recordState" = 'CURRENT'
    `,
  ]);
  const publishedByEdition = new Map(publications.map((row) => [
    editionKey(row.festivalSlug, row.editionYear), row._max.createdAt?.toISOString(),
  ]));
  const checksByEdition = new Map<string, SourceCheck[]>();
  for (const check of checks) {
    const existing = checksByEdition.get(check.editionId) ?? [];
    existing.push(check);
    checksByEdition.set(check.editionId, existing);
  }
  return { publishedByEdition, checksByEdition };
}

export function editionKey(slug: string, year: number): string {
  return `${slug}:${year}`;
}
