"use client";

import type { PlaylistCoverage } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: {
    unknown: "Verified coverage unavailable",
    matched: "Artists matched",
    tracks: "Tracks",
    recorded: "Last recorded sync",
  },
  de: {
    unknown: "Keine verifizierten Angaben zur Abdeckung",
    matched: "Zugeordnete Künstler",
    tracks: "Titel",
    recorded: "Letzter erfasster Abgleich",
  },
  ru: {
    unknown: "Подтверждённый охват неизвестен",
    matched: "Подобрано артистов",
    tracks: "Треки",
    recorded: "Последняя зафиксированная синхронизация",
  },
};

export function PlaylistCoverageLabel({ coverage }: { coverage?: PlaylistCoverage }) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  if (!coverage) return <span className="playlistCoverage">{t.unknown}</span>;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <span className="playlistCoverage">
      <span>
        {t.matched}: {coverage.matchedArtists.toLocaleString(locale)} · {t.tracks}:{" "}
        {coverage.tracks.toLocaleString(locale)}
      </span>
      <span>
        {t.recorded}:{" "}
        <time dateTime={coverage.recordedAt}>{date.format(new Date(coverage.recordedAt))}</time>
      </span>
    </span>
  );
}
