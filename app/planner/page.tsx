import { PlannerPage } from "@/components/PlannerPage";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";
export const metadata = { title: "My festival plan" };
export default async function Planner() {
  const { festivals, artists } = await getCatalog();
  return (
    <PlannerPage
      festivals={festivals}
      artists={artists.map(({ slug, name, aliases }) => ({ slug, name, aliases }))}
    />
  );
}
