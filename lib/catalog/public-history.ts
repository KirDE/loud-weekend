import { Prisma, type PrismaClient } from "@prisma/client";

const categories = {
  dates: ["startDate", "endDate", "dateLabel"],
  lineup: ["lineup", "headliners", "lineupDays"],
  tickets: ["ticketsUrl", "ticketStatus"],
  status: ["status"],
  timetable: ["timetable"],
} as const;

const publicationFields = Object.values(categories).flat();

function publicCategories(fields: string[]) {
  return (Object.keys(categories) as (keyof typeof categories)[]).filter((category) =>
    categories[category].some((field) => fields.includes(field)),
  );
}

export type EditionHistoryEntry = {
  publishedAt: string;
  categories: (keyof typeof categories)[];
};

export async function readEditionHistory(
  database: PrismaClient,
  festivalSlug: string,
  editionYear: number,
): Promise<EditionHistoryEntry[]> {
  const publications = await database.catalogPublication.findMany({
    where: { festivalSlug, editionYear, fields: { hasSome: publicationFields } },
    select: { createdAt: true, fields: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return publications.map((publication) => ({
    publishedAt: publication.createdAt.toISOString(),
    categories: publicCategories(publication.fields),
  }));
}

export const ANNOUNCEMENTS_PAGE_SIZE = 20;
export const ANNOUNCEMENTS_MAX_PAGE = 100;

export type AnnouncementFilters = {
  country: string;
  artist: string;
  days: 30 | 90 | null;
  page: number;
};

export function announcementFilters(
  query: Record<string, string | string[] | undefined>,
): AnnouncementFilters {
  return {
    country:
      typeof query.country === "string" && /^[A-Z]{2}$/.test(query.country) ? query.country : "",
    artist:
      typeof query.artist === "string" && /^[a-z0-9-]{1,200}$/.test(query.artist)
        ? query.artist
        : "",
    days: query.period === "30" ? 30 : query.period === "90" ? 90 : null,
    page:
      typeof query.page === "string" && /^[1-9]\d{0,2}$/.test(query.page)
        ? Math.min(Number(query.page), ANNOUNCEMENTS_MAX_PAGE)
        : 1,
  };
}

type AnnouncementRow = {
  publishedAt: Date;
  fields: string[];
  slug: string;
  year: number;
  name: string;
  officialUrl: string;
};

export async function readPublicAnnouncements(
  database: PrismaClient,
  filters: AnnouncementFilters,
) {
  const country = filters.country
    ? Prisma.sql`AND festival."countryCode" = ${filters.country}`
    : Prisma.empty;
  const period = filters.days
    ? Prisma.sql`AND publication."createdAt" >= ${new Date(Date.now() - filters.days * 86_400_000)}`
    : Prisma.empty;
  const artist = filters.artist
    ? Prisma.sql`AND publication."affectedArtistIds" @> ARRAY[
        (SELECT id FROM "Artist" WHERE slug = ${filters.artist})
      ]::text[]`
    : Prisma.empty;
  const offset = (filters.page - 1) * ANNOUNCEMENTS_PAGE_SIZE;
  // Join exact edition identity before paginating; select only approved public facts.
  const [rows, countries] = await Promise.all([
    database.$queryRaw<AnnouncementRow[]>`
      SELECT publication."createdAt" AS "publishedAt", publication.fields,
             festival.slug, edition.year, festival.name, festival."officialUrl"
      FROM "CatalogPublication" publication
      JOIN "Festival" festival ON festival.slug = publication."festivalSlug"
      JOIN "FestivalEdition" edition ON edition."festivalId" = festival.id AND edition.year = publication."editionYear"
      WHERE publication.fields && ARRAY[${Prisma.join(publicationFields)}]::text[]
      AND edition."recordState" IN ('CURRENT', 'ARCHIVED')
      ${country} ${period} ${artist}
      ORDER BY publication."createdAt" DESC, publication.id DESC
      LIMIT ${ANNOUNCEMENTS_PAGE_SIZE + 1} OFFSET ${offset}
    `,
    database.festival.findMany({
      where: { editions: { some: { recordState: { in: ["CURRENT", "ARCHIVED"] } } } },
      distinct: ["countryCode"],
      select: { countryCode: true, country: true },
      orderBy: [{ countryCode: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    countries,
    hasNext: rows.length > ANNOUNCEMENTS_PAGE_SIZE && filters.page < ANNOUNCEMENTS_MAX_PAGE,
    entries: rows.slice(0, ANNOUNCEMENTS_PAGE_SIZE).map(({ fields, publishedAt, ...entry }) => ({
      ...entry,
      publishedAt: publishedAt.toISOString(),
      categories: publicCategories(fields),
    })),
  };
}
