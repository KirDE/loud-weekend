import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { legacyFavoriteNames } from "@/lib/favorite-artist";
import { ArtistDetail } from "@/components/ArtistDetail";
import { supportedLanguages } from "@/lib/catalog/public";
import { getCatalog } from "@/lib/catalog/repository";
import { localizedAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  const { artists } = await getCatalog();
  const artist = artists.find((item) => item.slug === slug);
  if (!artist || !supportedLanguages.includes(lang as Language)) return {};
  return {
    title: artist.name,
    alternates: {
      canonical: `/${lang}/artists/${artist.slug}/`,
      languages: localizedAlternates(`/artists/${artist.slug}/`),
    },
  };
}

export default async function LocalizedArtistPage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  if (!supportedLanguages.includes(lang as Language)) notFound();
  const { artists, festivals } = await getCatalog();
  const artist = artists.find((item) => item.slug === slug);
  if (!artist) notFound();
  const appearances = festivals.filter((festival) =>
    [...festival.headliners, ...festival.lineup].includes(artist.name),
  );
  return (
    <ArtistDetail
      artist={artist}
      appearances={appearances}
      legacyFavoriteNames={legacyFavoriteNames(artist, artists)}
    />
  );
}
