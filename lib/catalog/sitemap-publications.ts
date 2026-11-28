import type { Prisma } from "@prisma/client";
import type { Festival } from "../domain/festival";
import { editionKey } from "./freshness";

type SitemapPublication = {
  festival: string | null;
  venue: string | null;
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
  // Venue dates apply only where the current public projection renders the venue.
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
        'ticketsUrl', 'lineup', 'headliners', 'finalLineup', 'lineupDays', 'timetable', 'recordState',
        'arrival', 'overview', 'camping'
      ]) AS festival,
      MAX("createdAt") FILTER (WHERE 'venue' = ANY(fields)) AS "venue",
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

// Match the already validated, rendered tier projection inside the same read
// transaction. The approval time, not the source observation, changes the page.
export async function readSitemapTicketOfferApprovals(
  db: Pick<Prisma.TransactionClient, "ticketOfferProposalSnapshot">,
  festivals: readonly Festival[],
  now: Date,
) {
  const rendered = festivals.flatMap(({ slug, ticketOffers }) =>
    ticketOffers
      ? [
          {
            edition: { year: ticketOffers.editionYear, festival: { slug } },
            sourceUrl: ticketOffers.sourceUrl,
            observedAt: new Date(ticketOffers.observedAt),
          },
        ]
      : [],
  );
  if (rendered.length === 0) return new Map<string, string>();
  const rows = await db.ticketOfferProposalSnapshot.findMany({
    where: { OR: rendered, decision: { is: { decision: "approve", createdAt: { lte: now } } } },
    select: {
      edition: { select: { year: true, festival: { select: { slug: true } } } },
      decision: { select: { createdAt: true } },
    },
  });
  return new Map(
    rows.flatMap(({ edition, decision }) =>
      decision
        ? [[editionKey(edition.festival.slug, edition.year), decision.createdAt.toISOString()]]
        : [],
    ),
  );
}
