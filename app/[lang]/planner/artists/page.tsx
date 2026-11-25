import { notFound } from "next/navigation";
import MyArtists, { metadata as baseMetadata } from "@/app/planner/artists/page";
import { isLanguage } from "@/lib/language-preference";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const titles = { en: "My artists", de: "Meine Künstler", ru: "Мои артисты" };
  if (!isLanguage(lang)) return {};
  return {
    ...baseMetadata,
    title: titles[lang],
    alternates: { ...baseMetadata.alternates, canonical: baseMetadata.alternates.languages[lang] },
  };
}

export default async function LocalizedMyArtists({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  if (!isLanguage((await params).lang)) notFound();
  return <MyArtists />;
}
