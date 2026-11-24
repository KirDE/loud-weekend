import { notFound } from "next/navigation";
import { SiteInformation } from "@/components/SiteInformation";
import { isLanguage } from "@/lib/language-preference";
import { informationMetadata } from "@/lib/site-information";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props) {
  const { lang } = await params;
  return isLanguage(lang) ? informationMetadata(lang, "about") : {};
}

export default async function Page({ params }: Props) {
  const { lang } = await params;
  if (!isLanguage(lang)) notFound();
  return <SiteInformation page="about" />;
}
