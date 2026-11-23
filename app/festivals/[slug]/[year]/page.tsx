import { notFound } from "next/navigation";
import { FestivalEditionContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath } from "@/lib/seo";

type Params = Promise<{ slug: string; year: string }>;

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Params }) {
  const { slug, year } = await params;
  return { alternates: { canonical: canonicalPath(`/festivals/${slug}/${Number(year)}`) } };
}

export default async function FestivalEditionPage({ params }: { params: Params }) {
  const { slug, year: rawYear } = await params;
  const { editions, artists } = await getCatalog();
  const item = editions.find((edition) => edition.slug === slug && edition.editionYear === Number(rawYear));
  if (!item) notFound();
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return <FestivalEditionContent item={item} artistSlugs={artistSlugs} />;
}
