import { hasArchiveRecords } from "@/lib/catalog/browse";
import { availableFestivalMonths } from "@/lib/festival-dates";
import type { MetadataRoute } from "next";
import { supportedLanguages } from "@/lib/catalog/public";
import { getCatalog } from "@/lib/catalog/repository";
import { SITE_ORIGIN } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { festivals, artists, editions, freshness } = await getCatalog({ includeFreshness: true });
  const editionYears = [...new Set(editions.map(({ editionYear }) => editionYear))];
  const countries = [...new Set(festivals.map((item) => item.countryCode.toLowerCase()))];
  const months = availableFestivalMonths(festivals).map((month) => String(month).padStart(2, "0"));
  return [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified: freshness.lastPublishedAt,
      changeFrequency: "daily",
      priority: 1,
    },
    ...festivals.map(({ slug, freshness }) => ({
      url: `${SITE_ORIGIN}/festivals/${slug}/`,
      lastModified: freshness?.lastPublishedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...artists.map(({ slug }) => ({
      url: `${SITE_ORIGIN}/artists/${slug}/`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...countries.map((code) => ({
      url: `${SITE_ORIGIN}/countries/${code}/`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...months.map((month) => ({
      url: `${SITE_ORIGIN}/months/${month}/`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...supportedLanguages.map((lang) => ({
      url: `${SITE_ORIGIN}/${lang}/`,
      lastModified: freshness.lastPublishedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...editionYears.map((year) => ({
      url: `${SITE_ORIGIN}/editions/${year}/`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...editions.map(({ slug, editionYear, snapshotAt }) => ({
      url: `${SITE_ORIGIN}/festivals/${slug}/${editionYear}/`,
      lastModified: snapshotAt,
      changeFrequency: editionYear < 2027 ? ("yearly" as const) : ("weekly" as const),
      priority: 0.6,
    })),
    {
      url: `${SITE_ORIGIN}/browse/`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...(hasArchiveRecords(editions)
      ? [
          {
            url: `${SITE_ORIGIN}/archive/`,
            changeFrequency: "monthly" as const,
            priority: 0.5,
          },
        ]
      : []),
    {
      url: `${SITE_ORIGIN}/submit/`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
