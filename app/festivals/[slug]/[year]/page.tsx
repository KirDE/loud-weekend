import type { Metadata } from "next";
import { socialPreviewMetadata } from "@/lib/social-preview";
import { EditionHistory } from "@/components/EditionHistory";
import { db } from "@/lib/db";
import { readEditionHistory } from "@/lib/catalog/public-history";
import { notFound } from "next/navigation";
import { FestivalEditionContent } from "@/components/PublicCatalogPages";
import { readArrivalFacts } from "@/lib/catalog/arrival-facts";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath } from "@/lib/seo";
import { editionOnHiatus } from "@/lib/edition-lifecycle";
import { readFestivalOverview } from "@/lib/catalog/festival-overviews";
import { lineupDayProfileSlugs } from "@/lib/festival-lineup";

type Params = Promise<{ slug: string; year: string }>;

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, year } = await params;
  if (!/^\d{4}$/.test(year)) return {};
  const { editions } = await getCatalog();
  const edition = editions.find((item) => item.slug === slug && item.editionYear === Number(year));
  if (!edition || edition.recordState === "tracking") return {};
  const canonical = canonicalPath(`/festivals/${edition.slug}/${edition.editionYear}`);
  return {
    ...socialPreviewMetadata(
      { kind: "festivals", name: edition.name, slug: edition.slug, year: edition.editionYear },
      canonical,
    ),
    title: `${edition.name} ${edition.editionYear}`,
    alternates: { canonical },
  };
}

export default async function FestivalEditionPage({ params }: { params: Params }) {
  const { slug, year: rawYear } = await params;
  const { editions, artists } = await getCatalog();
  const item = editions.find(
    (edition) => edition.slug === slug && edition.editionYear === Number(rawYear),
  );
  if (!item) notFound();
  const publicOverview =
    item.recordState === "current" && !editionOnHiatus(item)
      ? readFestivalOverview(db, item)
      : undefined;
  const [history, arrivalFacts, overview] = await Promise.all([
    item.editionYear === undefined ? [] : readEditionHistory(db, item.slug, item.editionYear),
    readArrivalFacts(db, item),
    publicOverview,
  ]);
  const artistSlugs = Object.fromEntries(artists.map(({ name, slug }) => [name, slug]));
  return (
    <>
      <FestivalEditionContent
        item={item}
        arrivalFacts={arrivalFacts}
        artistSlugs={artistSlugs}
        overview={overview}
        lineupDayArtistSlugs={lineupDayProfileSlugs(item.lineupDays, artists)}
      />
      <EditionHistory entries={history} officialUrl={item.officialUrl} />
    </>
  );
}
