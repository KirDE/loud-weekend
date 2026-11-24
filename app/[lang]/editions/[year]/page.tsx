import { notFound } from "next/navigation";
import { supportedLanguages } from "@/lib/catalog/public";
import { renderSeason, seasonMetadata } from "@/lib/season-page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lang: string; year: string }> };

export async function generateMetadata({ params }: Props) {
  const { lang, year } = await params;
  const language = supportedLanguages.find((item) => item === lang);
  if (!language) notFound();
  return seasonMetadata(year, language);
}

export default async function LocalizedEditionYearPage({ params }: Props) {
  const { lang, year } = await params;
  if (!supportedLanguages.some((item) => item === lang)) notFound();
  return renderSeason(year);
}
