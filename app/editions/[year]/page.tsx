import { renderSeason, seasonMetadata } from "@/lib/season-page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ year: string }> };

export async function generateMetadata({ params }: Props) {
  return seasonMetadata((await params).year);
}

export default async function EditionYearPage({ params }: Props) {
  return renderSeason((await params).year);
}
