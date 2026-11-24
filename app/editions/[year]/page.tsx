import { hasArchiveRecords } from "@/lib/catalog/browse";
import { notFound } from "next/navigation";
import { EditionYearContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  return /^\d{4}$/.test(year)
    ? { title: `${year} festival editions`, alternates: { canonical: `/editions/${year}/` } }
    : {};
}
export default async function EditionYearPage({ params }: { params: Promise<{ year: string }> }) {
  const year = Number((await params).year);
  const { editions } = await getCatalog();
  const items = editions.filter(({ editionYear }) => editionYear === year);
  if (!items.length) notFound();
  return <EditionYearContent year={year} items={items} hasArchive={hasArchiveRecords(editions)} />;
}
