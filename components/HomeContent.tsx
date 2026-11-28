"use client";

import Link from "next/link";
import { sharedSeasonYear } from "@/lib/catalog/seasons";
import type { SuggestionArtist } from "@/lib/discovery-suggestions";
import type { DiscoveryArtist } from "@/lib/discovery-artists";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import type { Festival } from "@/lib/domain/festival";
import { SeasonNavigation } from "./SeasonNavigation";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";
import { hasAnnouncedLineup } from "@/lib/festival-lineup";

const seasonEyebrow = {
  en: (year?: number) => (year ? `THE ${year} EUROPEAN SEASON` : "EUROPEAN FESTIVALS"),
  de: (year?: number) => (year ? `DIE EUROPÄISCHE SAISON ${year}` : "EUROPÄISCHE FESTIVALS"),
  ru: (year?: number) => (year ? `ЕВРОПЕЙСКИЙ СЕЗОН ${year}` : "ЕВРОПЕЙСКИЕ ФЕСТИВАЛИ"),
};

export function HomeContent({
  festivals,
  years,
  freshness,
  discoveryLineups,
  matchingArtists,
  suggestionArtists,
}: {
  festivals: Festival[];
  years: readonly number[];
  freshness: CatalogFreshness;
  discoveryLineups?: DiscoveryLineups;
  matchingArtists?: readonly DiscoveryArtist[];
  suggestionArtists?: readonly SuggestionArtist[];
}) {
  const { t, language } = useLanguage();
  const announced = festivals.filter(hasAnnouncedLineup).length;
  const countries = new Set(festivals.map((item) => item.countryCode)).size;
  return (
    <>
      <section className="hero">
        <div className="eyebrow">{seasonEyebrow[language](sharedSeasonYear(festivals))}</div>
        <h1>
          {t("heroFirst")}
          <br />
          <em>{t("heroSecond")}</em>
        </h1>
        <p>{t("heroText")}</p>
        <div className="heroStats">
          <span>
            <strong>{festivals.length}</strong> {t("festivals")}
          </span>
          <span>
            <strong>{announced}</strong> {t("withActs")}
          </span>
          <span>
            <strong>{countries}</strong> {t("countries")}
          </span>
        </div>
        <SeasonNavigation years={years} />
      </section>
      <FestivalExplorer
        festivals={festivals}
        freshness={freshness}
        discoveryLineups={discoveryLineups}
        matchingArtists={matchingArtists}
        suggestionArtists={suggestionArtists}
      />
      <p className="dataQualityLink">
        <Link className="textLink" href={`/${language}/data-quality/`}>
          {t("dataQuality")}
        </Link>
      </p>
    </>
  );
}
