import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { FestivalDetail } from "@/components/FestivalDetail";
import { supportedLanguages } from "@/lib/catalog/public";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { db } from "@/lib/db";
import { getCatalog } from "@/lib/catalog/repository";
import { festivalMusicEvent, localizedAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  const { festivals } = await getCatalog();
  const festival = festivals.find((item) => item.slug === slug);
  if (!festival || !supportedLanguages.includes(lang as Language)) return {};
  return {
    title: festival.name,
    alternates: {
      canonical: `/${lang}/festivals/${festival.slug}/`,
      languages: localizedAlternates(`/festivals/${festival.slug}/`),
    },
  };
}

export default async function LocalizedFestivalPage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  if (!supportedLanguages.includes(lang as Language)) notFound();
  const { festivals, artists, playlists } = await getCatalog({ includeFreshness: true });
  const item = festivals.find((festival) => festival.slug === slug);
  if (!item) notFound();
  const arrivalFacts = await readArrivalFacts(db, item);
  const event = festivalMusicEvent(item, lang);
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}
      />
      <FestivalDetail
        item={item}
        arrivalFacts={arrivalFacts}
        festivals={festivals}
        artistSlugs={artistSlugs}
        artistPopularity={Object.fromEntries(
          artists.map((artist) => [artist.name, artist.spotifyStats?.popularity ?? null]),
        )}
        playlist={playlists[item.slug]}
      />
    </>
  );
}
