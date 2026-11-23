import { notFound } from "next/navigation";
import { EditionYearContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath } from "@/lib/seo";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ year: string }> }) {
  return { alternates: { canonical: canonicalPath(`/editions/${Number((await params).year)}`) } };
}

export default async function EditionYearPage({ params }: { params: Promise<{ year: string }> }) {
  const year = Number((await params).year);
  const { editions } = await getCatalog();
  const items = editions.filter(({ editionYear }) => editionYear === year);
  if (!items.length) notFound();
  return <EditionYearContent year={year} items={items} />;
}
