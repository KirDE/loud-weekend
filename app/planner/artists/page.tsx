import { FavoriteArtistsPage } from "@/components/FavoriteArtistsPage";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";
const path = "/planner/artists/";
export const metadata = {
  title: "My artists",
  robots: { index: false },
  alternates: {
    canonical: path,
    languages: { "x-default": path, en: "/en" + path, de: "/de" + path, ru: "/ru" + path },
  },
};

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
