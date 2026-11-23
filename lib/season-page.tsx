import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EditionYearContent } from "@/components/PublicCatalogPages";
import type { SupportedLanguage } from "@/lib/catalog/public";
import { parseSeasonYear, publicSeasonEditions, seasonYears } from "@/lib/catalog/seasons";
import { getHomeCatalog } from "@/lib/home-metadata";

async function readSeason(rawYear: string) {
  const year = parseSeasonYear(rawYear);
  if (year === undefined) notFound();
  const { editions } = await getHomeCatalog();
  const publicEditions = publicSeasonEditions(editions);
  const items = publicEditions.filter(({ editionYear }) => editionYear === year);
  if (!items.length) notFound();
  return { year, items, years: seasonYears(publicEditions) };
}

export async function seasonMetadata(
  rawYear: string,
  language?: SupportedLanguage,
): Promise<Metadata> {
  const { year } = await readSeason(rawYear);
  const path = `/editions/${year}/`;
  const title = {
    en: `${year} festival editions`,
    de: `Festivalausgaben ${year}`,
    ru: `Выпуски фестивалей ${year} года`,
  };
  return {
    title: title[language ?? "en"],
    alternates: {
      canonical: language ? `/${language}${path}` : path,
      languages: { "x-default": path, en: `/en${path}`, de: `/de${path}`, ru: `/ru${path}` },
    },
  };
}

export async function renderSeason(rawYear: string) {
  return <EditionYearContent {...await readSeason(rawYear)} />;
}
