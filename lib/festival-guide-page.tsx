import { FestivalGuideContent } from "@/components/FestivalGuideContent";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog } from "./catalog/repository";
import { festivalGuides, isGuideTopic, selectGuideEditions } from "./festival-guides";
import { isLanguage } from "./language-preference";
import { localizedAlternates } from "./seo";

type Params = { topic: string; lang?: string };

export function festivalGuideMetadata({ topic, lang }: Params): Metadata {
  if (!isGuideTopic(topic) || (lang !== undefined && !isLanguage(lang))) return {};
  const copy = festivalGuides[topic][lang ?? "en"];
  const languages = localizedAlternates(`/guides/${topic}/`);
  return {
    title: copy.title,
    description: copy.intro,
    alternates: { canonical: languages[lang ?? "x-default"], languages },
  };
}

export async function FestivalGuide({ topic, lang }: Params) {
  if (!isGuideTopic(topic) || (lang !== undefined && !isLanguage(lang))) notFound();
  const { editions } = await getCatalog();
  const items = selectGuideEditions(topic, editions).map(
    ({ slug, editionYear, name, startDate, endDate }) => ({
      slug,
      editionYear,
      name,
      startDate,
      endDate,
    }),
  );
  return <FestivalGuideContent topic={topic} items={items} />;
}
