import { HomeContent } from "@/components/HomeContent";
import { getHomeCatalog, homeMetadata } from "@/lib/home-metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { festivals } = await getHomeCatalog();
  return homeMetadata("en", festivals.length);
}

export default async function Home() {
  const { festivals, discoveryLineups, matchingArtists } = await getHomeCatalog();
  return <HomeContent festivals={festivals} discoveryLineups={discoveryLineups} matchingArtists={matchingArtists} />;
}
