"use client";

import Link from "next/link";
import type { SuggestionArtist } from "@/lib/discovery-suggestions";
import type { DiscoveryArtist } from "@/lib/discovery-artists";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import type { Festival } from "@/lib/domain/festival";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";
import { hasAnnouncedLineup } from "@/lib/festival-lineup";

export function HomeContent({
  festivals,
  freshness,
  discoveryLineups,
  matchingArtists,
  suggestionArtists,
}: {
  festivals: Festival[];
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
