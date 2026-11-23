import { FavoriteArtistsPage } from "@/components/FavoriteArtistsPage";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "My artists", robots: { index: false } };

export default async function MyArtists() {
  const { artists, festivals, discoveryLineups } = await getCatalog();
  return (
    <FavoriteArtistsPage
      artists={artists.map(({ slug, name }) => ({ slug, name }))}
      festivals={festivals.map(({ slug, name, countryCode, editionYear, startDate, endDate }) => ({
        slug,
        name,
        countryCode,
        editionYear,
        startDate,
        endDate,
      }))}
      lineups={discoveryLineups}
    />
  );
}
