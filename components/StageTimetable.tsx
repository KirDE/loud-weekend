"use client";

import { useState } from "react";
import type { TimetableEntry } from "@/lib/domain/festival";
import { useLanguage, type Language } from "./LanguageProvider";
import { findTimetableConflicts, groupTimetable, timetableLocalDateTime } from "@/lib/timetables";

const copy: Record<Language, { title: string; empty: string; performances: (count: number) => string; checked: string; conflict: string; cancelled: string; timezone: string; source: string }> = {
  en: { title: "Stage timetable", empty: "No verified timetable is published yet. Stages and local times will appear after an official schedule is checked.", performances: (count) => `${count} verified performances · local festival time`, checked: "Checked", conflict: "More than one artist is listed for the same stage and start time. Check the official timetable.", cancelled: "Cancelled", timezone: "Timezone", source: "Official timetable source ↗" },
  de: { title: "Bühnenplan", empty: "Noch kein bestätigter Zeitplan veröffentlicht. Bühnen und Ortszeiten erscheinen nach Prüfung des offiziellen Plans.", performances: (count) => `${count} bestätigte Auftritte · Ortszeit des Festivals`, checked: "Geprüft", conflict: "Mehrere Künstler sind zur selben Startzeit auf derselben Bühne eingetragen. Prüfe den offiziellen Bühnenplan.", cancelled: "Abgesagt", timezone: "Zeitzone", source: "Offizieller Zeitplan ↗" },
  ru: { title: "Расписание сцен", empty: "Подтверждённое расписание пока не опубликовано. Сцены и местное время появятся после проверки официального расписания.", performances: (count) => `Подтверждённых выступлений: ${count} · местное время фестиваля`, checked: "Проверено", conflict: "На одной сцене на одно время указано несколько артистов. Проверьте официальное расписание.", cancelled: "Отменено", timezone: "Часовой пояс", source: "Официальное расписание ↗" },
};

const filters = {
  en: { day: "Timetable day", stage: "Timetable stage", allDays: "All days", allStages: "All stages", empty: "No published slots match these filters." },
  de: { day: "Tag im Bühnenplan", stage: "Bühne im Bühnenplan", allDays: "Alle Tage", allStages: "Alle Bühnen", empty: "Keine veröffentlichten Auftritte für diese Filter." },
  ru: { day: "День в расписании", stage: "Сцена в расписании", allDays: "Все дни", allStages: "Все сцены", empty: "По этим фильтрам нет опубликованных выступлений." },
};

export function StageTimetable({ entries }: { entries?: TimetableEntry[] }) {
  const { language, locale } = useLanguage();
  const [selectedDay, setDate] = useState("");
  const [selectedStage, setStage] = useState("");
  const t = copy[language];
  const labels = filters[language];
  if (!entries?.length) return <div className="timetable timetableEmpty"><strong>{t.title}</strong><span>{t.empty}</span></div>;
  const dates = [...new Set(entries.map(({ date }) => date))].sort();
  const stages = [...new Set(entries.map(({ stage }) => stage))].sort((a, b) => a.localeCompare(b, locale));
  const dayFilter = dates.includes(selectedDay) ? selectedDay : "";
  const stageFilter = stages.includes(selectedStage) ? selectedStage : "";
  const matches = entries.filter(({ date, stage }) => (!dayFilter || dayFilter === date) && (!stageFilter || stageFilter === stage));
  const days = groupTimetable(matches);
  const dayFormatter = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const dayLabel = (date: string) => dayFormatter.format(new Date(`${date}T12:00:00Z`));
  const conflicts = findTimetableConflicts(entries);
  const newestObservation = entries.map(({ observedAt }) => observedAt).sort().at(-1)!;
  return <section className="timetable timetablePublished" aria-labelledby="stage-timetable-heading">
    <div className="timetableHeader"><div><strong id="stage-timetable-heading">{t.title}</strong><span>{t.performances(entries.length)}</span></div><span>{t.checked} {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(newestObservation))}</span></div>
    {conflicts.length > 0 && <div className="timetableWarning" role="alert">{t.conflict}</div>}
    <div className="timetableFilters">
      <label>
        {labels.day}
        <select value={dayFilter} onChange={(event) => setDate(event.target.value)}>
          <option value="">{labels.allDays}</option>
          {dates.map(date => <option key={date} value={date}>{dayLabel(date)}</option>)}
        </select>
      </label>
      <label>
        {labels.stage}
        <select value={stageFilter} onChange={(event) => setStage(event.target.value)}>
          <option value="">{labels.allStages}</option>
          {stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}
        </select>
      </label>
    </div>
    {!matches.length && <p role="status">{labels.empty}</p>}
    {days.map((day) => <section className="timetableDay" key={day.date}>
      <h3><time dateTime={day.date}>{dayLabel(day.date)}</time></h3>
      <div className="timetableStages">{day.stages.map((stage) => <div className="timetableStage" key={stage.stage}>
        <h4>{stage.stage}</h4>
        <ol>{stage.entries.map((entry) => {
          const start = entry.window ? timetableLocalDateTime(entry.window.startsAt, entry.timeZone) : null;
          const end = entry.window ? timetableLocalDateTime(entry.window.endsAt, entry.timeZone) : null;
          const showOffsets = start?.offset !== end?.offset;
          return <li className={entry.status === "cancelled" ? "cancelled" : undefined} key={entry.sourcePerformanceId ? `official:${entry.sourcePerformanceId}` : `local:${entry.start}-${entry.artist}`}>
            <span className="timetableSlotTime">
              <time dateTime={entry.window?.startsAt ?? `${entry.date}T${entry.start}`}>{entry.start}{showOffsets && ` ${start?.offset}`}</time>
              {end && entry.window && <>–<time dateTime={entry.window.endsAt}>{end.time}{showOffsets && ` ${end.offset}`}{end.date !== entry.date && ` (${dayLabel(end.date)})`}</time></>}
            </span>
            <span>{entry.artist}</span>{entry.status === "cancelled" && <em>{t.cancelled}</em>}
          </li>;
        })}</ol>
      </div>)}</div>
    </section>)}
    <footer><span>{t.timezone}: {entries[0].timeZone}</span><a href={entries[0].sourceUrl} target="_blank" rel="noreferrer">{t.source}</a></footer>
  </section>;
}
