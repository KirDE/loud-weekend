import type { Prisma } from "@prisma/client";
import { editionKey } from "./freshness";

type SitemapPublication = {
  festival: string | null;
  directory: string | null;
  edition: string | null;
  listing: string | null;
  appearance: string | null;
  sharedName: string | null;
};

export async function readSitemapPublications(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  now: Date,
) {
  // These are public field identifiers, not audit values or source checks.
  // A festival name is shared by all its editions, even across year boundaries.
  // Agent conflict resolutions publish provenance rendered on the edition dossier,
  // even when their changed fields are not otherwise displayed there.
  const rows = await db.$queryRaw<
    (Record<keyof SitemapPublication, Date | null> & { slug: string; year: number })[]
  >`
    SELECT "festivalSlug" AS slug, "editionYear" AS year,
      MAX("createdAt") FILTER (WHERE fields && ARRAY[
        'name', 'city', 'country', 'countryCode', 'genres', 'officialUrl',
        'startDate', 'endDate', 'dateLabel', 'status', 'completeness', 'ticketStatus',
        'ticketsUrl', 'lineup', 'headliners', 'finalLineup', 'lineupDays', 'timetable', 'recordState', 'arrival'
      ]) AS festival,
      MAX("createdAt") FILTER (WHERE fields && ARRAY[
        'city', 'country', 'countryCode', 'genres', 'startDate', 'endDate', 'status',
        'ticketStatus', 'ticketsUrl', 'lineup', 'headliners', 'finalLineup', 'recordState'
      ]) AS directory,
      MAX("createdAt") FILTER (WHERE fields && ARRAY[
        'startDate', 'endDate', 'status', 'completeness', 'lineup', 'headliners', 'recordState', 'arrival'
      ] OR (
        source = 'ADMIN'
        AND evidence->>'reviewPolicy' = 'openclaw-import-conflicts-v1'
        AND cardinality(fields) > 0
      )) AS edition,
      MAX("createdAt") FILTER (WHERE fields && ARRAY[
        'startDate', 'endDate', 'status', 'recordState', 'lineup', 'headliners', 'finalLineup'
      ]) AS listing,
      MAX("createdAt") FILTER (WHERE fields && ARRAY['city', 'countryCode', 'startDate']) AS appearance,
      MAX("createdAt") FILTER (WHERE 'name' = ANY(fields)) AS "sharedName"
    FROM "CatalogPublication"
    WHERE "createdAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY "festivalSlug", "editionYear"`;
  return new Map(
    rows.map(({ slug, year, ...dates }) => [
      editionKey(slug, year),
      {
        slug,
        ...(Object.fromEntries(
          Object.entries(dates).map(([scope, date]) => [scope, date?.toISOString() ?? null]),
        ) as SitemapPublication),
      },
    ]),
  );
}
