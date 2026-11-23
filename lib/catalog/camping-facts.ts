import type { EditionCampingField, PrismaClient } from "@prisma/client";
import type { Festival } from "../domain/festival.ts";

type Source = { sourceUrl: string; checkedOn: string };
export type PublicCampingFact = Source & (
  | { field: "arrival"; earliestDate: string }
  | { field: Exclude<EditionCampingField, "arrival">; description: Record<"en" | "de" | "ru", string> }
);

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

export async function readCampingFacts(
  db: PrismaClient,
  item: Pick<Festival, "slug" | "editionYear" | "city" | "countryCode" | "officialUrl">,
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
          slug: item.slug, city: item.city, countryCode: item.countryCode, officialUrl: item.officialUrl,
        },
      },
    },
    select: {
      field: true, descriptionEn: true, descriptionDe: true, descriptionRu: true,
      earliestDate: true, sourceUrl: true, checkedOn: true,
    },
    orderBy: { field: "asc" },
  });
  const facts: PublicCampingFact[] = [];
  for (const row of rows) {
    if (campingSourceHost(row.sourceUrl) !== organizerHost) continue;
    const source = { sourceUrl: row.sourceUrl, checkedOn: row.checkedOn.toISOString().slice(0, 10) };
    if (row.field === "arrival") {
      if (row.earliestDate) facts.push({
        ...source, field: row.field, earliestDate: row.earliestDate.toISOString().slice(0, 10),
      });
    } else if (row.descriptionEn && row.descriptionDe && row.descriptionRu) {
      facts.push({
        ...source, field: row.field, description: { en: row.descriptionEn, de: row.descriptionDe, ru: row.descriptionRu },
      });
    }
  }
  return facts;
}
