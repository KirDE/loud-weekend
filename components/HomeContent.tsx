"use client";

import Link from "next/link";
import type { CatalogFreshness } from "@/lib/domain/freshness";
import type { Festival } from "@/lib/domain/festival";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";
import { hasAnnouncedLineup } from "@/lib/festival-lineup";

export function HomeContent({
  festivals,
  freshness,
}: {
  festivals: Festival[];
  freshness: CatalogFreshness;
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
      <FestivalExplorer festivals={festivals} freshness={freshness} />
      <p className="dataQualityLink">
        <Link className="textLink" href={`/${language}/data-quality/`}>
          {t("dataQuality")}
        </Link>
      </p>
    </>
  );
}
