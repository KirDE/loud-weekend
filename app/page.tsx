import { publicSeasonEditions, seasonYears } from "@/lib/catalog/seasons";
import { HomeContent } from "@/components/HomeContent";
import { getHomeCatalog, homeMetadata } from "@/lib/home-metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { festivals } = await getHomeCatalog();
  return homeMetadata("en", festivals.length);
}

export default async function Home() {
  const { festivals, editions, freshness, discoveryLineups, matchingArtists, suggestionArtists } =
    await getHomeCatalog();
  return (
    <HomeContent
      festivals={festivals}
      freshness={freshness}
      discoveryLineups={discoveryLineups}
      years={seasonYears(publicSeasonEditions(editions))}
      matchingArtists={matchingArtists}
      suggestionArtists={suggestionArtists}
    />
  );
}
