import { HomeContent } from "@/components/HomeContent";
import { getHomeCatalog, homeMetadata } from "@/lib/home-metadata";
import { localizedAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { festivals } = await getHomeCatalog();
  return { ...homeMetadata("en", festivals.length), alternates: { canonical: "/", languages: localizedAlternates("/") } };
}

export default async function Home() {
  const { festivals, freshness } = await getHomeCatalog();
  return <HomeContent festivals={festivals} freshness={freshness} />;
}
