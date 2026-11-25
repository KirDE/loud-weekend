import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/ArtistDetail";
import { artistMetadata, readArtistPage } from "@/lib/artist-page";
import { isLanguage } from "@/lib/language-preference";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

type Props = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLanguage(lang)) return {};
  const data = await readArtistPage(slug);
  return data ? artistMetadata(data.artist, data.appearances, lang) : {};
}

export default async function ArtistPage({ params }: Props) {
  const { lang, slug } = await params;
  if (!isLanguage(lang)) notFound();
  const data = await readArtistPage(slug);
  if (!data) notFound();
  return (
    <ArtistDetail
      artist={data.artist}
      appearances={data.appearances}
      legacySlugs={data.legacySlugs}
    />
  );
}
