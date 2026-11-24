import { notFound } from "next/navigation";
import { hasArchiveRecords } from "@/lib/catalog/browse";
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
  if (!hasArchiveRecords(publicEditions)) notFound();
  return (
    <ArchiveContent
      years={seasonYears(publicEditions)}
      archived={publicEditions.filter(({ recordState }) => recordState === "archived")}
      future={publicEditions.filter(({ recordState }) => recordState === "tracking")}
    />
  );
}
