import { notFound } from "next/navigation";
import { FestivalEditionContent } from "@/components/PublicCatalogPages";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { db } from "@/lib/db";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";
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
  const arrivalFacts = await readArrivalFacts(db, item);
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return (
    <FestivalEditionContent item={item} arrivalFacts={arrivalFacts} artistSlugs={artistSlugs} />
  );
}
