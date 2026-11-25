import { FestivalGuide, festivalGuideMetadata } from "@/lib/festival-guide-page";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ topic: string }> };
export async function generateMetadata({ params }: Props) {
  return festivalGuideMetadata(await params);
}
export default async function GuidePage({ params }: Props) {
  return <FestivalGuide {...await params} />;
}
