import { publicSeasonEditions, seasonYears } from "@/lib/catalog/seasons";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { HomeContent } from "@/components/HomeContent";
import { supportedLanguages } from "@/lib/catalog/public";
import { getHomeCatalog, homeMetadata } from "@/lib/home-metadata";
import { localizedAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const dynamicParams = false;
export function generateStaticParams() {
  return supportedLanguages.map((lang) => ({ lang }));
}
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) return {};
  const { festivals } = await getHomeCatalog();
  return {
    ...homeMetadata(lang, festivals),
    manifest: `/${lang}/manifest.webmanifest`,
    alternates: {
      canonical: `/${lang}/`,
      languages: localizedAlternates("/"),
    },
  };
}
export default async function LocalizedHome({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang;
  if (!supportedLanguages.some((value) => value === lang)) notFound();
  const { festivals, editions, freshness, discoveryLineups, matchingArtists, suggestionArtists } =
    await getHomeCatalog();
  return (
    <HomeContent
      festivals={festivals}
      freshness={freshness}
      discoveryLineups={discoveryLineups}
      years={seasonYears(publicSeasonEditions(editions))}
      matchingArtists={matchingArtists}
      suggestionArtists={suggestionArtists}
    />
  );
}
