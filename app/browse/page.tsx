import type { Metadata } from "next";
import { CatalogueBrowse } from "@/components/CatalogueBrowse";
import { catalogueBrowse } from "@/lib/catalog/browse";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse the festival catalogue",
  description: "Find festival countries, months, artists and edition records.",
  alternates: { canonical: "/browse/" },
};

export default async function BrowsePage() {
  const { festivals, editions, artists } = await getCatalog();
  return <CatalogueBrowse data={catalogueBrowse(festivals, editions, artists)} />;
}
