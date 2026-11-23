import type { EditionArrivalKind, PrismaClient } from "@prisma/client";
import type { Festival } from "../domain/festival.ts";
import type { SupportedLanguage } from "./public.ts";

export type PublicArrivalFact = {
  kind: EditionArrivalKind;
  description: Record<SupportedLanguage, string>;
  sourceUrl: string;
  checkedOn: string;
};

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

export async function readArrivalFacts(
  db: PrismaClient,
  item: Pick<Festival, "slug" | "editionYear" | "officialUrl" | "countryCode">,
): Promise<PublicArrivalFact[]> {
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
    select: {
      kind: true, descriptionEn: true, descriptionDe: true, descriptionRu: true,
      sourceUrl: true, checkedOn: true,
    },
    orderBy: { kind: "asc" },
  });

  return rows.filter(row => arrivalSourceHost(row.sourceUrl) === organizerHost).map(row => ({
    kind: row.kind,
    description: { en: row.descriptionEn, de: row.descriptionDe, ru: row.descriptionRu },
    sourceUrl: row.sourceUrl,
    checkedOn: row.checkedOn.toISOString().slice(0, 10),
  }));
}
