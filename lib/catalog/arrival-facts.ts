import type { Prisma, PrismaClient } from "@prisma/client";
import type { FestivalEdition } from "../domain/edition.ts";
import { editionOnHiatus } from "../edition-lifecycle.ts";
import type { Festival, PublicArrivalFact } from "../domain/festival.ts";

export function arrivalSourceHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) {
      return url.hostname.replace(/^www\./, "");
    }
  } catch {
    // Unparseable URLs are not eligible sources.
  }
}

export const arrivalFactSelect = {
  editionYear: true,
  organizerHost: true,
  countryCode: true,
  kind: true,
  descriptionEn: true,
  descriptionDe: true,
  descriptionRu: true,
  sourceUrl: true,
  checkedOn: true,
} satisfies Prisma.EditionArrivalFactSelect;
type ArrivalRow = Prisma.EditionArrivalFactGetPayload<{ select: typeof arrivalFactSelect }>;
type ArrivalEdition = Pick<Festival, "slug" | "editionYear" | "countryCode" | "officialUrl">;

export async function readArrivalFacts(
  db: PrismaClient,
  item: ArrivalEdition &
    Pick<Festival, "editionLifecycle"> &
    Partial<Pick<FestivalEdition, "recordState">>,
): Promise<PublicArrivalFact[]> {
  if (item.recordState !== "archived" && editionOnHiatus(item)) return [];

  const organizerHost = arrivalSourceHost(item.officialUrl);
  if (!organizerHost || item.editionYear === undefined) return [];

  const rows = await db.editionArrivalFact.findMany({
    where: {
      organizerHost,
      countryCode: item.countryCode,
      editionYear: item.editionYear,
      edition: {
        year: item.editionYear,
        festival: { slug: item.slug, officialUrl: item.officialUrl, countryCode: item.countryCode },
      },
    },
    select: arrivalFactSelect,
    orderBy: { kind: "asc" },
  });

  return publicArrivalFacts(item, rows);
}

export function publicArrivalFacts(
  item: ArrivalEdition,
  rows: readonly ArrivalRow[],
): PublicArrivalFact[] {
  const organizerHost = arrivalSourceHost(item.officialUrl);
  if (!organizerHost || item.editionYear === undefined) return [];
  return rows
    .filter(
      (row) =>
        row.editionYear === item.editionYear &&
        row.countryCode === item.countryCode &&
        row.organizerHost === organizerHost &&
        arrivalSourceHost(row.sourceUrl) === organizerHost,
    )
    .map((row) => ({
      kind: row.kind,
      description: { en: row.descriptionEn, de: row.descriptionDe, ru: row.descriptionRu },
      sourceUrl: row.sourceUrl,
      checkedOn: row.checkedOn.toISOString().slice(0, 10),
    }));
}
