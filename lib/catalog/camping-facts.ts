import type { Prisma, PrismaClient } from "@prisma/client";
import type { Festival, PublicCampingFact } from "../domain/festival.ts";

export function campingSourceHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) {
      return url.hostname.replace(/^www\./, "");
    }
  } catch {
    // An invalid URL cannot establish organizer identity.
  }
}

export const campingFactSelect = {
  editionYear: true,
  organizerHost: true,
  countryCode: true,
  city: true,
  field: true,
  descriptionEn: true,
  descriptionDe: true,
  descriptionRu: true,
  earliestDate: true,
  sourceUrl: true,
  checkedOn: true,
} satisfies Prisma.EditionCampingFactSelect;
type CampingRow = Prisma.EditionCampingFactGetPayload<{ select: typeof campingFactSelect }>;
type CampingEdition = Pick<
  Festival,
  "slug" | "editionYear" | "city" | "countryCode" | "officialUrl"
>;

export async function readCampingFacts(
  db: PrismaClient,
  item: CampingEdition,
): Promise<PublicCampingFact[]> {
  const organizerHost = campingSourceHost(item.officialUrl);
  if (!organizerHost || !item.city || item.editionYear === undefined) return [];

  const rows = await db.editionCampingFact.findMany({
    where: {
      editionYear: item.editionYear,
      city: item.city,
      countryCode: item.countryCode,
      organizerHost,
      edition: {
        year: item.editionYear,
        festival: {
          slug: item.slug,
          city: item.city,
          countryCode: item.countryCode,
          officialUrl: item.officialUrl,
        },
      },
    },
    select: campingFactSelect,
    orderBy: { field: "asc" },
  });
  return publicCampingFacts(item, rows);
}

export function publicCampingFacts(
  item: CampingEdition,
  rows: readonly CampingRow[],
): PublicCampingFact[] {
  const organizerHost = campingSourceHost(item.officialUrl);
  if (!organizerHost || !item.city || item.editionYear === undefined) return [];
  const facts: PublicCampingFact[] = [];
  for (const row of rows) {
    if (!(
      row.editionYear === item.editionYear &&
      row.countryCode === item.countryCode &&
      row.city === item.city &&
      row.organizerHost === organizerHost &&
      campingSourceHost(row.sourceUrl) === organizerHost
    ))
      continue;
    const source = {
      sourceUrl: row.sourceUrl,
      checkedOn: row.checkedOn.toISOString().slice(0, 10),
    };
    if (row.field === "arrival") {
      if (row.earliestDate)
        facts.push({
          ...source,
          field: row.field,
          earliestDate: row.earliestDate.toISOString().slice(0, 10),
        });
    } else if (row.descriptionEn && row.descriptionDe && row.descriptionRu) {
      facts.push({
        ...source,
        field: row.field,
        description: { en: row.descriptionEn, de: row.descriptionDe, ru: row.descriptionRu },
      });
    }
  }
  return facts;
}
