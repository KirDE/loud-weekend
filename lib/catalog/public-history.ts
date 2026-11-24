import type { PrismaClient } from "@prisma/client";

const categories = {
  dates: ["startDate", "endDate", "dateLabel"],
  lineup: ["lineup", "headliners", "lineupDays"],
  tickets: ["ticketsUrl", "ticketStatus"],
  timetable: ["timetable"],
} as const;

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
    where: { festivalSlug, editionYear, fields: { hasSome: Object.values(categories).flat() } },
    select: { createdAt: true, fields: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return publications.map((publication) => ({
    publishedAt: publication.createdAt.toISOString(),
    categories: (Object.keys(categories) as (keyof typeof categories)[]).filter((category) =>
      categories[category].some((field) => publication.fields.includes(field)),
    ),
  }));
}
