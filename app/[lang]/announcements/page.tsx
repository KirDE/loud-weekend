import type { Metadata } from "next";
import { AnnouncementsTimeline } from "@/components/AnnouncementsTimeline";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { supportedLanguages, type SupportedLanguage } from "@/lib/catalog/public";
import { announcementFilters, readPublicAnnouncements } from "@/lib/catalog/public-history";
import { publicHistoryCopy } from "@/lib/catalog/public-history-copy";

type Props = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function languageFor(value: string): SupportedLanguage {
  if (!supportedLanguages.includes(value as SupportedLanguage)) notFound();
  return value as SupportedLanguage;
}

const pathFor = (language: SupportedLanguage) => `/${language}/announcements/`;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const language = languageFor((await params).lang);
  const query = await searchParams;
  const copy = publicHistoryCopy[language];
  return {
    title: copy.timeline,
    description: copy.intro,
    alternates: {
      canonical: pathFor(language),
      languages: {
        en: pathFor("en"),
        de: pathFor("de"),
        ru: pathFor("ru"),
        "x-default": pathFor("en"),
      },
    },
    robots: Object.keys(query).length
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}

export default async function AnnouncementsPage({ params, searchParams }: Props) {
  languageFor((await params).lang);
  const filters = announcementFilters(await searchParams);
  const timeline = await readPublicAnnouncements(db, filters);
  return <AnnouncementsTimeline key={JSON.stringify(filters)} filters={filters} {...timeline} />;
}
