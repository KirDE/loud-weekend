import type { Metadata } from "next";
import { cache } from "react";
import { getCatalog } from "./catalog/repository";
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
  const { artists, festivals } = await getCatalog();
  const artist = artists.find((item) => item.slug === slug);
  if (!artist) return null;
  const uniqueBillingName = !artists.some(
    (item) => item.slug !== slug && item.name === artist.name,
  );
  const appearances = uniqueBillingName
    ? festivals.filter(
        (item) => item.headliners.includes(artist.name) || item.lineup.includes(artist.name),
      )
    : [];
  return { artist, appearances };
});

export function artistMetadata(
  artist: { slug: string; name: string },
  appearances: readonly Festival[],
  language?: Language,
): Metadata {
  const locale = language ?? "en";
  const t = phrases[locale];
  const path = `/artists/${artist.slug}/`;
  const names = [...new Set(appearances.map((item) => item.name))]
    .sort((a, b) => a.localeCompare(b, locale))
    .slice(0, 3);
  const description = names.length
    ? `${artist.name} · ${t.appearances}: ${new Intl.ListFormat(locale).format(names)}.`
    : `${artist.name} · ${t.fallback}`;
  return {
    title: artist.name,
    description,
    alternates: {
      canonical: language ? `/${language}${path}` : path,
      languages: { "x-default": path, en: `/en${path}`, de: `/de${path}`, ru: `/ru${path}` },
    },
  };
}
