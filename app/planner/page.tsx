import { PlannerPage } from "@/components/PlannerPage";
import { getCatalog } from "@/lib/catalog/repository";
import { publicSeasonEditions, seasonYears } from "@/lib/catalog/seasons";
export const dynamic = "force-dynamic";
export const metadata = { title: "My festival plan" };
export default async function Planner() {
  const { festivals, editions, artists, discoveryLineups } = await getCatalog();
  return (
    <PlannerPage
      festivals={festivals}
      years={seasonYears(publicSeasonEditions(editions))}
      catalogueArtists={artists.map(({ name, slug, aliases }) => ({ name, slug, aliases }))}
      lineups={discoveryLineups}
    />
  );
}
