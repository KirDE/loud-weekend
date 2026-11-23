import type { Metadata } from "next";
import { cache } from "react";
import { getCatalog } from "./catalog/repository";
import type { SupportedLanguage } from "./catalog/public";

// Share one request-scoped catalogue snapshot between metadata and visible stats.
export const getHomeCatalog = cache(async () => {
  const catalogue = await getCatalog();
  const inLineups = new Set(Object.values(catalogue.discoveryLineups.artistSlugsByFestival).flat());
  const matchingArtists = catalogue.artists.filter(({ slug }) => inLineups.has(slug)).map(({ slug, name }) => ({ slug, name }));
  const suggestionArtists = catalogue.artists.map(({ slug, name, aliases }) => ({ slug, name, aliases }));
  return { ...catalogue, matchingArtists, suggestionArtists };
});

export function homeMetadata(language: SupportedLanguage, count: number): Metadata {
  const title = "Loud Weekend 2027";
  const festivalWord = new Intl.PluralRules("ru").select(count);
  const ruNoun = festivalWord === "one" ? "фестиваль" : festivalWord === "few" ? "фестиваля" : "фестивалей";
  const descriptions: Record<SupportedLanguage, string> = {
    en: `${count} European rock and metal ${count === 1 ? "festival" : "festivals"}: dates, lineups, tickets, playlists and setlists.`,
    de: `${count} ${count === 1 ? "europäisches Rock- und Metal-Festival" : "europäische Rock- und Metal-Festivals"}: Termine, Line-ups, Tickets, Playlists und Setlists.`,
    ru: `${count} рок- и метал-${ruNoun} Европы: даты, лайнапы, билеты, плейлисты и сетлисты.`,
  };
  const description = descriptions[language];
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}
