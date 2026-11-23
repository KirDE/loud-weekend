"use client";

import type { PlaylistCoverage } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: {
    unknown: "Verified coverage unavailable",
    matched: "Artists matched",
    tracks: "Tracks",
    recorded: "Last recorded sync",
    failed: "Latest refresh failed",
  },
  de: {
    unknown: "Keine verifizierten Angaben zur Abdeckung",
    matched: "Zugeordnete Künstler",
    tracks: "Titel",
    recorded: "Letzter erfasster Abgleich",
    failed: "Letzte Aktualisierung fehlgeschlagen",
  },
  ru: {
    unknown: "Подтверждённый охват неизвестен",
    matched: "Подобрано артистов",
    tracks: "Треки",
    recorded: "Последняя зафиксированная синхронизация",
    failed: "Последнее обновление не удалось",
  },
};

export function PlaylistCoverageLabel({
  coverage,
  failed,
}: {
  coverage?: PlaylistCoverage;
  failed?: boolean;
}) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  if (!coverage) return <span className="playlistCoverage">{failed ? t.failed : t.unknown}</span>;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <span className="playlistCoverage">
      {failed && <span>{t.failed}</span>}
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
