"use client";

import type { PlaylistCoverage } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";

const copy = {
  en: {
    unknown: "Verified coverage unavailable",
    reported: "Artists reported",
    tracks: "Tracks",
    recorded: "Last recorded sync",
    failed: "Latest refresh failed",
    matched: (matched: string, eligible: string) => `Artists matched: ${matched} / ${eligible}`,
    unmatched: "Without a verified match",
    complete: "All eligible artists matched",
  },
  de: {
    unknown: "Keine verifizierten Angaben zur Abdeckung",
    reported: "Erfasste Künstler",
    tracks: "Titel",
    recorded: "Letzter erfasster Abgleich",
    failed: "Letzte Aktualisierung fehlgeschlagen",
    matched: (matched: string, eligible: string) =>
      `Zugeordnete Künstler: ${matched} / ${eligible}`,
    unmatched: "Ohne bestätigte Zuordnung",
    complete: "Alle berücksichtigten Künstler zugeordnet",
  },
  ru: {
    unknown: "Подтверждённый охват неизвестен",
    reported: "Указано артистов",
    tracks: "Треки",
    recorded: "Последняя зафиксированная синхронизация",
    failed: "Последнее обновление не удалось",
    matched: (matched: string, eligible: string) => `Подобрано артистов: ${matched} / ${eligible}`,
    unmatched: "Без подтверждённого совпадения",
    complete: "Все учтённые артисты подобраны",
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
  const { verified } = coverage;
  const missing = verified ? verified.eligibleArtists - verified.matchedArtists : 0;
  const format = (count: number) => count.toLocaleString(locale);
  return (
    <span className="playlistCoverage">
      {failed && <span>{t.failed}</span>}
      <span>
        {verified
          ? t.matched(format(verified.matchedArtists), format(verified.eligibleArtists))
          : `${t.reported}: ${format(coverage.reportedArtists)}`}{" "}
        · {t.tracks}: {format(coverage.tracks)}
      </span>
      {verified && <span>{missing ? `${t.unmatched}: ${format(missing)}` : t.complete}</span>}
      <span>
        {t.recorded}:{" "}
        <time dateTime={coverage.recordedAt}>{date.format(new Date(coverage.recordedAt))}</time>
      </span>
    </span>
  );
}
