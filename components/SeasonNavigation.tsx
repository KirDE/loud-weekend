"use client";

import Link from "next/link";
import { useLanguage } from "./LanguageProvider";

export function SeasonNavigation({
  years,
  selectedYear,
}: {
  years: readonly number[];
  selectedYear?: number;
}) {
  const { language } = useLanguage();
  if (!years.length) return null;
  const label = { en: "Festival seasons", de: "Festivalsaisons", ru: "Фестивальные сезоны" }[
    language
  ];
  return (
    <nav className="seasonNavigation" aria-label={label}>
      {years.map((year) => (
        <Link
          key={year}
          href={`/${language}/editions/${year}/`}
          aria-current={year === selectedYear ? "page" : undefined}
        >
          {year}
        </Link>
      ))}
    </nav>
  );
}
