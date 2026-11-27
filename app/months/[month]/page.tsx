import { notFound } from "next/navigation";
import { MonthContent } from "@/components/PublicCatalogPages";
import { festivalOverlapsMonth } from "@/lib/festival-dates";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";
export const dynamicParams = true;
export async function generateMetadata({ params }: { params: Promise<{ month: string }> }) {
  const month = (await params).month;
  return {
    title: `European festivals in month ${month}`,
    alternates: { canonical: `/months/${month}/` },
  };
}
export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  const month = (await params).month;
  const { festivals, discoveryLineups } = await getCatalog({ includeComparisonTripFacts: true });
  const items = festivals.filter(
    (item) => /^\d{2}$/.test(month) && festivalOverlapsMonth(item, Number(month)),
  );
  if (!items.length) notFound();
  return <MonthContent month={month} festivals={items} discoveryLineups={discoveryLineups} />;
}
