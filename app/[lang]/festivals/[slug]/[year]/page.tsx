import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FestivalEditionPage from "@/app/festivals/[slug]/[year]/page";
import { getCatalog } from "@/lib/catalog/repository";
import { supportedLanguages } from "@/lib/catalog/public";
import { parseSeasonYear, publicSeasonEditions } from "@/lib/catalog/seasons";
import { canonicalPath, localizedAlternates } from "@/lib/seo";
import { socialPreviewMetadata } from "@/lib/social-preview";

type Props = { params: Promise<{ lang: string; slug: string; year: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug, year } = await params;
  const language = supportedLanguages.find((item) => item === lang);
  if (!language) notFound();
  const editionYear = parseSeasonYear(year);
  if (editionYear === undefined) return {};
  const { editions } = await getCatalog();
  const edition = editions.find((item) => item.slug === slug && item.editionYear === editionYear);
  if (!edition || (edition.recordState === "tracking" && !publicSeasonEditions([edition]).length))
    return {};
  const path = canonicalPath(`/festivals/${edition.slug}/${edition.editionYear}`);
  const canonical = `/${language}${path}`;
  return {
    ...socialPreviewMetadata(
      { kind: "festivals", name: edition.name, slug: edition.slug, year: edition.editionYear },
      canonical,
      language,
    ),
    title: `${edition.name} ${edition.editionYear}`,
    alternates: { canonical, languages: localizedAlternates(path) },
  };
}

export default async function LocalizedFestivalEditionPage({ params }: Props) {
  const { lang, slug, year } = await params;
  if (!supportedLanguages.some((language) => language === lang)) notFound();
  return FestivalEditionPage({ params: Promise.resolve({ slug, year }) });
}
