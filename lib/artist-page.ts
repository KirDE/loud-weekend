import type { Metadata } from "next";
import { cache } from "react";
import { localizedAlternates } from "./seo";
import { socialPreviewMetadata } from "./social-preview";
import { getCatalog } from "./catalog/repository";
import { editionOnHiatus } from "./edition-lifecycle";
import type { Festival } from "./domain/festival";
import type { Language } from "./language-preference";

const phrases = {
  en: {
    appearances: "Announced festival appearances",
    fallback: "Explore this artist on Loud Weekend.",
  },
  de: {
    appearances: "Angekündigte Festivalauftritte",
    fallback: "Entdecke diesen Act auf Loud Weekend.",
  },
  ru: {
    appearances: "Объявленные выступления на фестивалях",
    fallback: "Узнайте об артисте на Loud Weekend.",
  },
};

export const readArtistPage = cache(async (slug: string) => {
  const { artists, festivals, discoveryLineups } = await getCatalog();
  const artist = artists.find((item) => item.slug === slug);
  if (!artist) return null;
  const appearances = festivals.filter(
    (festival) =>
      !editionOnHiatus(festival) &&
      discoveryLineups.artistSlugsByFestival[festival.slug]?.includes(artist.slug),
  );
  const legacySlugs = Object.fromEntries(
    Object.entries(discoveryLineups.legacyFavoriteSlugs).filter(([, slug]) => slug === artist.slug),
  );
  return { artist, appearances, legacySlugs };
});

export function artistMetadata(
  artist: { slug: string; name: string },
  appearances: readonly Festival[],
  language?: Language,
): Metadata {
  const locale = language ?? "en";
  const t = phrases[locale];
  const path = `/artists/${artist.slug}/`;
  const names = [
    ...new Set(
      appearances.map(({ name, editionYear }) => (editionYear ? `${name} ${editionYear}` : name)),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, locale))
    .slice(0, 3);
  const description = names.length
    ? `${artist.name} · ${t.appearances}: ${new Intl.ListFormat(locale).format(names)}.`
    : `${artist.name} · ${t.fallback}`;
  const canonical = language ? `/${language}${path}` : path;
  return {
    ...socialPreviewMetadata({ kind: "artists", ...artist }, canonical, locale),
    title: artist.name,
    description,
    alternates: {
      canonical,
      languages: localizedAlternates(path),
    },
  };
}
