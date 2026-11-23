import { ArchiveContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";
import { publicSeasonEditions, seasonYears } from "@/lib/catalog/seasons";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Festival archives and future editions",
  description: "Browse provenance-aware Loud Weekend editions.",
  alternates: { canonical: "/archive/" },
};

export default async function ArchivePage() {
  const { editions } = await getCatalog();
  const publicEditions = publicSeasonEditions(editions);
  return (
    <ArchiveContent
      years={seasonYears(publicEditions)}
      archived={publicEditions.filter(({ recordState }) => recordState === "archived")}
      future={publicEditions.filter(({ recordState }) => recordState === "tracking")}
    />
  );
}
