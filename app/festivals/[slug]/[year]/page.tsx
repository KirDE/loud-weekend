import type { Metadata } from "next";
import { socialPreviewMetadata } from "@/lib/social-preview";
import { notFound } from "next/navigation";
import { FestivalEditionContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}): Promise<Metadata> {
  const { slug, year } = await params;
  if (!/^\d{4}$/.test(year)) return {};
  const { editions } = await getCatalog();
  const edition = editions.find((item) => item.slug === slug && item.editionYear === Number(year));
  if (!edition || edition.recordState === "tracking") return {};
  const canonical = `/festivals/${edition.slug}/${edition.editionYear}/`;
  return {
    ...socialPreviewMetadata(
      { kind: "festivals", name: edition.name, slug: edition.slug, year: edition.editionYear },
      canonical,
    ),
    title: `${edition.name} ${edition.editionYear}`,
    alternates: { canonical },
  };
}

export default async function FestivalEditionPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year: rawYear } = await params;
  const { editions, artists } = await getCatalog();
  const item = editions.find(
    (edition) => edition.slug === slug && edition.editionYear === Number(rawYear),
  );
  if (!item) notFound();
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return <FestivalEditionContent item={item} artistSlugs={artistSlugs} />;
}
