import type { FestivalEdition } from "./domain/edition.ts";
import { festivalDateInterval } from "./festival-dates.ts";
import type { Language } from "./language-preference.ts";

export const guideTopics = ["germany", "multi-day"] as const;
export type GuideTopic = (typeof guideTopics)[number];
export const isGuideTopic = (value: string): value is GuideTopic =>
  guideTopics.some((topic) => topic === value);

type GuideCopy = { title: string; intro: string; criterion: string; checklist: readonly string[] };

export const festivalGuides: Record<GuideTopic, Record<Language, GuideCopy>> = {
  germany: {
    en: {
      title: "Planning a festival trip in Germany",
      intro:
        "Start with the actual festival site, not just the town name. A nearby station does not " +
        "guarantee an easy last leg or a late return.",
      criterion:
        "These current German editions have published start and end dates with date evidence in the catalogue.",
      checklist: [
        "Check the organiser’s arrival and departure instructions before buying transport.",
        "Check the last connection after the final set and allow for the journey from the entrance.",
      ],
    },
    de: {
      title: "Festivalreise in Deutschland planen",
      intro:
        "Plane ab dem tatsächlichen Festivalgelände, nicht nur nach dem Ortsnamen. Ein Bahnhof in der " +
        "Nähe garantiert weder eine einfache Anreise noch eine späte Rückfahrt.",
      criterion:
        "Diese aktuellen Ausgaben in Deutschland haben veröffentlichte Start- und Enddaten mit Datumsbeleg im Katalog.",
      checklist: [
        "Prüfe vor der Buchung die An- und Abreisehinweise des Veranstalters.",
        "Prüfe die letzte Verbindung nach dem letzten Auftritt und plane Zeit für den Weg vom Eingang ein.",
      ],
    },
    ru: {
      title: "Как спланировать поездку на фестиваль в Германии",
      intro:
        "Уточните расположение площадки, а не только название города. Близкая станция не гарантирует " +
        "удобный маршрут до входа или поздний обратный рейс.",
      criterion:
        "У этих актуальных фестивалей в Германии опубликованы даты начала и окончания, подтверждённые " +
        "источниками в каталоге.",
      checklist: [
        "Проверьте рекомендации организатора по проезду до покупки билетов на транспорт.",
        "Узнайте время последнего рейса после финального выступления и учтите путь от входа до остановки.",
      ],
    },
  },
  "multi-day": {
    en: {
      title: "Planning a multi-day festival",
      intro:
        "Compare the full festival span before booking travel or accommodation. The published date " +
        "range does not say which day a particular artist will perform.",
      criterion:
        "These current editions span at least three calendar days, using published start and end dates " +
        "with catalogue evidence.",
      checklist: [
        "Check the official day allocation or timetable before choosing a day ticket.",
        "Verify campsite or accommodation dates separately; they can differ from the festival dates.",
      ],
    },
    de: {
      title: "Ein mehrtägiges Festival planen",
      intro:
        "Vergleiche den gesamten Festivalzeitraum, bevor du Anreise oder Unterkunft buchst. Aus den " +
        "Festivaldaten geht nicht hervor, an welchem Tag ein bestimmter Act spielt.",
      criterion:
        "Diese aktuellen Ausgaben dauern mindestens drei Kalendertage, berechnet anhand " +
        "veröffentlichter Start- und Enddaten mit Katalogbeleg.",
      checklist: [
        "Prüfe vor dem Kauf eines Tagestickets die offizielle Tagesaufteilung oder den Spielplan.",
        "Prüfe die Termine für Camping oder Unterkunft separat; sie können vom Festivalzeitraum abweichen.",
      ],
    },
    ru: {
      title: "Как спланировать многодневный фестиваль",
      intro:
        "Сравните полную продолжительность фестивалей до бронирования проезда и жилья. Общие даты не " +
        "показывают, в какой день выступит конкретный артист.",
      criterion:
        "Эти актуальные фестивали занимают не менее трёх календарных дней по опубликованным датам " +
        "начала и окончания, подтверждённым в каталоге.",
      checklist: [
        "Перед покупкой билета на один день проверьте официальную разбивку по дням или расписание.",
        "Уточните даты работы кемпинга или проживания отдельно: они могут отличаться от дат самого фестиваля.",
      ],
    },
  },
};

export function selectGuideEditions(topic: GuideTopic, editions: readonly FestivalEdition[]) {
  return editions
    .filter((edition) => {
      if (edition.recordState !== "current" || edition.status === "tba" || !edition.endDate)
        return false;
      const evidence = new Set<string>(edition.provenance.map(({ field }) => field));
      if (!evidence.has("dates") && !(evidence.has("startDate") && evidence.has("endDate")))
        return false;
      const interval = festivalDateInterval(edition);
      if (!interval || interval.start.getUTCFullYear() !== edition.editionYear) return false;
      return topic === "germany"
        ? edition.countryCode === "DE"
        : interval.end.valueOf() - interval.start.valueOf() >= 2 * 86_400_000;
    })
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.slug.localeCompare(b.slug));
}
