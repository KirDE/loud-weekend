"use client";

import type { SuggestionArtist } from "@/lib/discovery-suggestions";
import type { DiscoveryArtist } from "@/lib/discovery-artists";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import type { Festival } from "@/lib/domain/festival";
import { SeasonNavigation } from "./SeasonNavigation";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";
import { hasAnnouncedLineup } from "@/lib/festival-lineup";

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
  const { t } = useLanguage();
  const announced = festivals.filter(hasAnnouncedLineup).length;
  const countries = new Set(festivals.map((item) => item.countryCode)).size;
  return (
    <>
      <section className="hero">
        <div className="eyebrow">{t("season")}</div>
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
    </>
  );
}
