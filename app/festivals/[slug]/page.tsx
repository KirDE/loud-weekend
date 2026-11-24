import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalDetail } from "@/components/FestivalDetail";
import { socialPreviewMetadata } from "@/lib/social-preview";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { db } from "@/lib/db";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath, festivalMusicEvent } from "@/lib/seo";

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
  if (!festival) return {};
  const canonical = canonicalPath(`/festivals/${festival.slug}`);
  return {
    ...(festival.editionYear &&
      socialPreviewMetadata(
        { kind: "festivals", name: festival.name, slug: festival.slug, year: festival.editionYear },
        canonical,
      )),
    title: festival.name,
    description: `${festival.name}: dates, lineup, tickets, playlist and setlists.`,
    alternates: { canonical },
  };
}

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { festivals, artists, playlists } = await getCatalog({ includeFreshness: true });
  const requestedSlug = (await params).slug;
  const item = festivals.find(({ slug }) => slug === requestedSlug);
  if (!item) notFound();
  const arrivalFacts = await readArrivalFacts(db, item);
  const event = festivalMusicEvent(item);
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
