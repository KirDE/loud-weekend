import { getPlaylistRefreshFailures } from "@/lib/catalog/playlist-refresh-readback";
import { EditionHistory } from "@/components/EditionHistory";
import { db } from "@/lib/db";
import { readEditionHistory } from "@/lib/catalog/public-history";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lineupDayProfileSlugs } from "@/lib/festival-lineup";
import type { Language } from "@/components/LanguageProvider";
import { FestivalDetail } from "@/components/FestivalDetail";
import { supportedLanguages } from "@/lib/catalog/public";
import { readCampingFacts } from "@/lib/catalog/camping-facts";
import { readFestivalOverview } from "@/lib/catalog/festival-overviews";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { getCatalog } from "@/lib/catalog/repository";
import { festivalMusicEvent } from "@/lib/seo";

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
      languages: {
        "x-default": `/festivals/${festival.slug}/`,
        en: `/en/festivals/${festival.slug}/`,
        de: `/de/festivals/${festival.slug}/`,
        ru: `/ru/festivals/${festival.slug}/`,
      },
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
  const { festivals, artists, playlists, discoveryLineups } = await getCatalog({
    includeFreshness: true,
  });
  const item = festivals.find((festival) => festival.slug === slug);
  if (!item) notFound();
  const [arrivalFacts, campingFacts] = await Promise.all([
    readArrivalFacts(db, item),
    readCampingFacts(db, item),
  ]);
  const failures = item.editionYear
    ? await getPlaylistRefreshFailures(item.slug, item.editionYear)
    : {};
  const overview = await readFestivalOverview(db, item);
  const history =
    item.editionYear === undefined ? [] : await readEditionHistory(db, item.slug, item.editionYear);
  const event = festivalMusicEvent(item, lang);
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}
      />
      <FestivalDetail
        overview={overview}
        item={item}
        arrivalFacts={arrivalFacts}
        campingFacts={campingFacts}
        festivals={festivals}
        discoveryLineups={discoveryLineups}
        artistSlugs={artistSlugs}
        lineupDayArtistSlugs={lineupDayProfileSlugs(item.lineupDays, artists)}
        artistPopularity={Object.fromEntries(
          artists.map((artist) => [artist.name, artist.spotifyStats?.popularity ?? null]),
        )}
        playlist={playlists[item.slug]}
        playlistRefreshFailures={failures}
      />
      <EditionHistory entries={history} officialUrl={item.officialUrl} />
    </>
  );
}
