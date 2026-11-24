import { PlannerPage } from "@/components/PlannerPage";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";
export const metadata = { title: "My festival plan" };
export default async function Planner() {
  const { festivals, artists, discoveryLineups } = await getCatalog();
  return (
    <PlannerPage
      festivals={festivals}
      catalogueArtists={artists.map(({ name, slug, aliases }) => ({ name, slug, aliases }))}
      lineups={discoveryLineups}
    />
  );
}
