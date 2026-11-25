"use client";

import type { FestivalEdition } from "@/lib/domain/edition";
import { hasSeasonCalendarDates } from "@/lib/catalog/seasons";
import { calendarFile } from "@/lib/planning";
import { useLanguage } from "./LanguageProvider";
import { useLocalPlanner, type Attendance } from "./LocalPlanner";

const labels = {
  en: {
    local:
      "Saved in this browser. Exports include only Going or Maybe selections with verified dates.",
    attendance: "Attendance",
    none: "Not set",
    going: "Going",
    maybe: "Maybe",
    "not-going": "Not going",
    export: "Download season calendar (.ics)",
  },
  de: {
    local:
      "Lokal gespeichert. Der Export enthält nur „Dabei“ oder „Vielleicht“ mit belegten Terminen.",
    attendance: "Teilnahme",
    none: "Nicht ausgewählt",
    going: "Dabei",
    maybe: "Vielleicht",
    "not-going": "Nicht dabei",
    export: "Saisonkalender herunterladen (.ics)",
  },
  ru: {
    local:
      "План хранится в браузере. В экспорт входят «Пойду» и «Возможно» с подтверждёнными датами.",
    attendance: "Посещение",
    none: "Не выбрано",
    going: "Пойду",
    maybe: "Возможно",
    "not-going": "Не пойду",
    export: "Скачать календарь сезона (.ics)",
  },
} as const;

export function EditionAttendance({ item }: { item: FestivalEdition }) {
  const { language } = useLanguage();
  const t = labels[language];
  const planner = useLocalPlanner();
  return (
    <label className="seasonAttendance">
      {t.attendance}
      <select
        aria-label={`${t.attendance}: ${item.name} ${item.editionYear}`}
        disabled={!planner.ready}
        value={planner.editionAttendance(item.slug, item.editionYear) ?? ""}
        onChange={({ target }) =>
          planner.setEditionAttendance(
            item.slug,
            item.editionYear,
            (target.value || undefined) as Attendance | undefined,
          )
        }
      >
        <option value="">{t.none}</option>
        <option value="going">{t.going}</option>
        <option value="maybe">{t.maybe}</option>
        <option value="not-going">{t["not-going"]}</option>
      </select>
    </label>
  );
}

export function SeasonCalendar({
  year,
  items,
}: {
  year: number;
  items: readonly FestivalEdition[];
}) {
  const { language } = useLanguage();
  const t = labels[language];
  const planner = useLocalPlanner();
  const dated = items.filter((item) => {
    const attendance = planner.editionAttendance(item.slug, year);
    return (
      planner.ready &&
      (attendance === "going" || attendance === "maybe") &&
      hasSeasonCalendarDates(item)
    );
  });
  return (
    <div className="seasonCalendar">
      <p>{t.local}</p>
      {dated.length > 0 && (
        <a
          className="outlineButton"
          href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`}
          download={`loud-weekend-${year}-plan.ics`}
        >
          {t.export}
        </a>
      )}
    </div>
  );
}
