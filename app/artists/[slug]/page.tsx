import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/ArtistDetail";
import { artistMetadata, readArtistPage } from "@/lib/artist-page";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await readArtistPage(slug);
  return data ? artistMetadata(data.artist, data.appearances) : {};
}

export default async function ArtistPage({ params }: Props) {
  const { slug } = await params;
  const data = await readArtistPage(slug);
  if (!data) notFound();
  return <ArtistDetail artist={data.artist} appearances={data.appearances} />;
}
