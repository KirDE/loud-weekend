import { EditionHistory } from "@/components/EditionHistory";
import { db } from "@/lib/db";
import { readEditionHistory } from "@/lib/catalog/public-history";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalDetail } from "@/components/FestivalDetail";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath, festivalDescription, festivalMusicEvent } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { festivals } = await getCatalog();
  const requestedSlug = (await params).slug;
  const festival = festivals.find(({ slug }) => slug === requestedSlug);
  return festival
    ? {
        title: festival.name,
        description: festivalDescription(festival),
        alternates: { canonical: canonicalPath(`/festivals/${festival.slug}`) },
      }
    : {};
}

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { festivals, artists, playlists, discoveryLineups } = await getCatalog({
    includeFreshness: true,
  });
  const requestedSlug = (await params).slug;
  const item = festivals.find(({ slug }) => slug === requestedSlug);
  if (!item) notFound();
  const history =
    item.editionYear === undefined ? [] : await readEditionHistory(db, item.slug, item.editionYear);
  const arrivalFacts = await readArrivalFacts(db, item);
  const event = festivalMusicEvent(item);
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return (
    <>
      {event && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}
        />
      )}
      <FestivalDetail
        item={item}
        arrivalFacts={arrivalFacts}
        festivals={festivals}
        discoveryLineups={discoveryLineups}
        artistSlugs={artistSlugs}
        artistPopularity={Object.fromEntries(
          artists.map((artist) => [artist.name, artist.spotifyStats?.popularity ?? null]),
        )}
        playlist={playlists[item.slug]}
      />
      <EditionHistory entries={history} officialUrl={item.officialUrl} />
    </>
  );
}
