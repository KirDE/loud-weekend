import type { PrismaClient } from "@prisma/client";
import type { Festival } from "../domain/festival.ts";
import type { SupportedLanguage } from "./public.ts";

export type PublicFestivalOverview = {
  checkedOn: string;
  sources: string[];
  summary: Record<SupportedLanguage, string>;
};

export function overviewSourceHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash) {
      return url.hostname.replace(/^www\./, "");
    }
  } catch {
    // Unparseable URLs are not eligible sources.
  }
}

export async function readFestivalOverview(
  db: PrismaClient,
  item: Pick<Festival, "slug" | "editionYear" | "city" | "countryCode" | "officialUrl">,
): Promise<PublicFestivalOverview | undefined> {
  const organizerHost = overviewSourceHost(item.officialUrl);
  if (!organizerHost || !item.city || item.editionYear === undefined) return;

  const row = await db.editionOverview.findFirst({
    where: {
      city: item.city, countryCode: item.countryCode, organizerHost,
      edition: {
        year: item.editionYear,
        festival: { slug: item.slug, city: item.city, countryCode: item.countryCode, officialUrl: item.officialUrl },
      },
    },
    select: { checkedOn: true, sourceUrls: true, summaryEn: true, summaryDe: true, summaryRu: true },
  });
  if (!row?.sourceUrls.length || row.sourceUrls.some(url => overviewSourceHost(url) !== organizerHost)) return;

  return {
    checkedOn: row.checkedOn.toISOString().slice(0, 10),
    sources: row.sourceUrls,
    summary: { en: row.summaryEn, de: row.summaryDe, ru: row.summaryRu },
  };
}
