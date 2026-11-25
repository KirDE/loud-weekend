"use client";

import Link from "next/link";
import { editionRecordCompleteness } from "@/lib/edition-status";
import { festivalDateInterval } from "@/lib/festival-dates";
import { lineupPresentation } from "@/lib/festival-lineup";
import type { Festival } from "@/lib/domain/festival";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import type { FestivalEdition } from "@/lib/domain/edition";
import type { PublicArrivalFact } from "@/lib/catalog/arrival-facts";
import { FestivalArrival } from "./FestivalArrival";
import { FestivalExplorer } from "./FestivalExplorer";
import { EditionAttendance, SeasonCalendar } from "./SeasonPlan";
import { SeasonNavigation } from "./SeasonNavigation";
import { useLanguage } from "./LanguageProvider";

// Public route bodies use the selected UI language; their server routes and SEO
// metadata remain independent of the saved preference and unchanged.
const copy = {
  en: {
    editions: "FESTIVAL EDITIONS",
    archiveTitle: "Archived and future records",
    archiveIntro:
      "Archived and tracked editions are listed with explicit source evidence. " +
      "Archived snapshots are immutable; future editions appear only after an official edition-specific announcement.",
    archived: "Archived editions",
    future: "Future tracking",
    futureEmpty: "No officially announced future editions are being tracked yet.",
    datesTba: "Dates TBA",
    archivedArtists: (n: number) => n + " archived artists",
    openEdition: "Open edition →",
    editionYear: "EDITION YEAR",
    editionHeading: (year: number) => year + " festival editions",
    records: (n: number) =>
      n +
      " provenance-aware " +
      (n === 1 ? "record" : "records") +
      ". TBA means the official source has not yet published the field.",
    artistsRecorded: (n: number) => n + " artists recorded",
    archiveBack: "← Archive and future tracking",
    backEdition: (year: number) => "← " + year + " editions",
    states: { archived: "ARCHIVED", current: "CURRENT", tracking: "TRACKING" },
    edition: "EDITION",
    completeRecord: "complete record",
    partialRecord: "partial record",
    pendingRecord: "Catalogue record pending",
    lineupStatus: "Lineup status",
    noArtists: "No current acts listed",
    trackingNotice: "This is an explicit tracking state, not an empty confirmed lineup.",
    provenance: "Provenance",
    snapshot: "Immutable snapshot captured",
    officialSource: "Official source ↗",
    checked: "checked",
    fields: { edition: "edition", dates: "dates", lineup: "lineup", finalLineup: "full lineup" },
    sharedEyebrow: "PUBLIC FESTIVAL PLAN",
    sharedTitle: "Shared plan",
    updated: "Last updated",
    attendance: "Festival attendance",
    noAttendance: "No attendance selections have been shared yet.",
    attendanceValues: { going: "Going", maybe: "Maybe", "not-going": "Not going" },
    unspecified: "Not specified",
    country: (name: string) => "Festivals in " + name,
    month: (name: string) => "Festivals in " + name,
  },
  de: {
    editions: "FESTIVALAUSGABEN",
    archiveTitle: "Archivierte und künftige Ausgaben",
    archiveIntro:
      "Jede Ausgabe enthält nachvollziehbare Quellenangaben. Archiv" +
      "ierte Stände bleiben unverändert; künftige Ausgaben erschein" +
      "en erst nach einer offiziellen Ankündigung.",
    archived: "Archivierte Ausgaben",
    future: "Künftige Ausgaben",
    futureEmpty: "Derzeit werden keine offiziell angekündigten künftigen Ausgaben verfolgt.",
    datesTba: "Termine offen",
    archivedArtists: (n: number) => n + " archivierte Künstler",
    openEdition: "Ausgabe öffnen →",
    editionYear: "AUSGABEJAHR",
    editionHeading: (year: number) => "Festivalausgaben " + year,
    records: (n: number) =>
      n +
      " Ausgaben mit Quellenangaben. Offene Angaben wurden von offizieller Seite noch nicht veröffentlicht.",
    artistsRecorded: (n: number) => n + " erfasste Künstler",
    archiveBack: "← Archiv und künftige Ausgaben",
    backEdition: (year: number) => "← Ausgaben " + year,
    states: { archived: "ARCHIVIERT", current: "AKTUELL", tracking: "IN BEOBACHTUNG" },
    edition: "AUSGABE",
    completeRecord: "vollständiger Datensatz",
    partialRecord: "unvollständiger Datensatz",
    pendingRecord: "Katalogeintrag noch offen",
    lineupStatus: "Line-up-Status",
    noArtists: "Derzeit keine Acts gelistet",
    trackingNotice:
      "Dieser Status bedeutet, dass die Ausgabe beobachtet wird; das Line-up ist nicht als vollständig bestätigt.",
    provenance: "Quellenangaben",
    snapshot: "Unveränderlicher Stand gespeichert am",
    officialSource: "Offizielle Quelle ↗",
    checked: "geprüft",
    fields: {
      edition: "Ausgabe",
      dates: "Termine",
      lineup: "Line-up",
      finalLineup: "vollständiges Line-up",
    },
    sharedEyebrow: "ÖFFENTLICHER FESTIVALPLAN",
    sharedTitle: "Geteilter Plan",
    updated: "Zuletzt aktualisiert",
    attendance: "Festivalteilnahme",
    noAttendance: "Noch keine Teilnahmeangaben geteilt.",
    attendanceValues: { going: "Dabei", maybe: "Vielleicht", "not-going": "Nicht dabei" },
    unspecified: "Nicht angegeben",
    country: (name: string) => "Festivals in " + name,
    month: (name: string) => "Festivals im " + name,
  },
  ru: {
    editions: "ВЫПУСКИ ФЕСТИВАЛЕЙ",
    archiveTitle: "Архивные и будущие выпуски",
    archiveIntro:
      "Для каждого выпуска указаны источники. Архивные снимки не ме" +
      "няются; будущие выпуски появляются только после официального" +
      " объявления конкретного года.",
    archived: "Архивные выпуски",
    future: "Будущие выпуски",
    futureEmpty: "Пока нет официально объявленных будущих выпусков.",
    datesTba: "Даты уточняются",
    archivedArtists: (n: number) => "Артистов в архиве: " + n,
    openEdition: "Открыть выпуск →",
    editionYear: "ГОД ВЫПУСКА",
    editionHeading: (year: number) => "Выпуски фестивалей " + year + " года",
    records: (n: number) =>
      "Записей с указанием источников: " +
      n +
      ". Неизвестные сведения ещё не опубликованы официально.",
    artistsRecorded: (n: number) => "Артистов в записи: " + n,
    archiveBack: "← Архив и будущие выпуски",
    backEdition: (year: number) => "← Выпуски " + year + " года",
    states: { archived: "АРХИВ", current: "ТЕКУЩИЙ", tracking: "ОТСЛЕЖИВАЕТСЯ" },
    edition: "ВЫПУСК",
    completeRecord: "полная запись",
    partialRecord: "частичная запись",
    pendingRecord: "Запись каталога уточняется",
    lineupStatus: "Состояние лайнапа",
    noArtists: "Нет действующих анонсов",
    trackingNotice: "Выпуск отслеживается; пустой лайнап не означает подтверждённый состав.",
    provenance: "Источники данных",
    snapshot: "Неизменяемый снимок сохранён",
    officialSource: "Официальный источник ↗",
    checked: "проверено",
    fields: { edition: "выпуск", dates: "даты", lineup: "лайнап", finalLineup: "полный лайнап" },
    sharedEyebrow: "ОБЩИЙ ПЛАН ФЕСТИВАЛЕЙ",
    sharedTitle: "Общий план",
    updated: "Обновлено",
    attendance: "Посещение фестивалей",
    noAttendance: "Данные о посещении ещё не опубликованы.",
    attendanceValues: { going: "Пойду", maybe: "Возможно", "not-going": "Не пойду" },
    unspecified: "Не указано",
    country: (name: string) => "Фестивали в стране: " + name,
    month: (name: string) => "Фестивали в " + name,
  },
} as const;

function usePublicCopy() {
  const { language, locale, t: translateLabel } = useLanguage();
  const t = copy[language];
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(value.length === 10 ? value + "T12:00:00Z" : value),
    );
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  const range = (item: FestivalEdition) =>
    festivalDateInterval(item) && item.startDate
      ? date(item.startDate) +
        (item.endDate && item.endDate !== item.startDate ? " — " + date(item.endDate) : "")
      : t.datesTba;
  return { t, date, dateTime, range, locale, translateLabel };
}

function EditionRow({
  item,
  archive = false,
  planning = false,
}: {
  item: FestivalEdition;
  archive?: boolean;
  planning?: boolean;
}) {
  const { t, range, translateLabel } = usePublicCopy();
  const count = item.headliners.length + item.lineup.length;
  const summary =
    count === 0 ? t.noArtists : archive ? t.archivedArtists(count) : t.artistsRecorded(count);
  return (
    <article className={planning ? "directoryRow seasonEditionRow" : "directoryRow"}>
      <div>
        <strong>
          {item.name} {item.editionYear}
        </strong>
        <span>
          {range(item)} · {summary}
          {item.finalLineup && count > 0 ? " · " + translateLabel("finalLineup") : ""}
        </span>
      </div>
      <Link className="textLink" href={`/festivals/${item.slug}/${item.editionYear}/`}>
        {t.openEdition}
      </Link>
      {planning && <EditionAttendance item={item} />}
    </article>
  );
}

export function ArchiveContent({
  archived,
  future,
  years,
}: {
  archived: FestivalEdition[];
  future: FestivalEdition[];
  years: readonly number[];
}) {
  const { t } = usePublicCopy();
  return (
    <div className="directoryPage">
      <p className="eyebrow">{t.editions}</p>
      <h1>{t.archiveTitle}</h1>
      <p>{t.archiveIntro}</p>
      <SeasonNavigation years={years} />
      <section>
        <h2>{t.archived}</h2>
        {archived.map((item) => (
          <EditionRow item={item} archive key={item.slug + "-" + item.editionYear} />
        ))}
      </section>
      <section>
        <h2>{t.future}</h2>
        {future.length ? (
          future.map((item) => <EditionRow item={item} key={item.slug + "-" + item.editionYear} />)
        ) : (
          <p>{t.futureEmpty}</p>
        )}
      </section>
    </div>
  );
}

export function EditionYearContent({
  year,
  items,
  years,
  hasArchive,
}: {
  year: number;
  items: FestivalEdition[];
  years: readonly number[];
  hasArchive: boolean;
}) {
  const { t } = usePublicCopy();
  const { t: ui } = useLanguage();
  return (
    <div className="directoryPage">
      <p className="eyebrow">{t.editionYear}</p>
      <h1>{t.editionHeading(year)}</h1>
      <p>{t.records(items.length)}</p>
      <SeasonNavigation years={years} selectedYear={year} />
      <SeasonCalendar year={year} items={items} />
      <section>
        {items.map((item) => (
          <EditionRow
            item={item}
            archive={item.recordState === "archived"}
            planning
            key={item.slug}
          />
        ))}
      </section>
      <Link className="textLink" href={hasArchive ? "/archive/" : "/browse/"}>
        {hasArchive ? t.archiveBack : ui("browseCatalogue")}
      </Link>
    </div>
  );
}

export function FestivalEditionContent({
  item,
  artistSlugs = {},
  arrivalFacts = [],
}: {
  item: FestivalEdition;
  artistSlugs?: Readonly<Record<string, string>>;
  arrivalFacts?: readonly PublicArrivalFact[];
}) {
  const { t, date, dateTime, range, translateLabel } = usePublicCopy();
  const artists = [...item.headliners, ...item.lineup];
  const completeness = editionRecordCompleteness(item);
  const recordLabel = {
    complete: t.completeRecord,
    partial: t.partialRecord,
    tba: t.pendingRecord,
  }[completeness];
  const recordTone = completeness === "complete" ? "confirmed" : completeness;
  const lineup = lineupPresentation(item);
  return (
    <div className="detailPage">
      <Link className="back" href={"/editions/" + item.editionYear + "/"}>
        {t.backEdition(item.editionYear)}
      </Link>
      <section className="detailHero editionDetailHero">
        <div className="editionDetailBody">
          <div className="eyebrow">
            {t.states[item.recordState]} {t.edition} · {item.countryCode}
          </div>
          <h1>
            {item.name} {item.editionYear}
          </h1>
          <p className="detailDate">{range(item)}</p>
          <span className={"status " + recordTone}>{recordLabel}</span>
        </div>
      </section>
      <section className="lineupSection">
        <h2>{t.lineupStatus}</h2>
        {artists.length > 0 && <p>{translateLabel(lineup.label)}</p>}
        {artists.length ? (
          <div className="lineupGrid">
            {artists.map((artist) =>
              artistSlugs[artist] ? (
                <Link key={artist} href={`/artists/${artistSlugs[artist]}/`}>
                  {artist}
                </Link>
              ) : (
                <span key={artist}>{artist}</span>
              ),
            )}
          </div>
        ) : (
          <div className="lineupEmpty">
            <strong>{t.noArtists}</strong>
            {item.recordState === "tracking" && <span>{t.trackingNotice}</span>}
          </div>
        )}
      </section>
      <FestivalArrival facts={arrivalFacts} />
      <section className="sourceNote">
        <strong>{t.provenance}</strong>
        {item.snapshotAt && (
          <p>
            {t.snapshot} {dateTime(item.snapshotAt)} UTC.
          </p>
        )}
        {item.provenance.map((source) => (
          <p key={source.field + "-" + source.url}>
            <b>
              {
                t.fields[
                  source.field === "startDate" || source.field === "endDate"
                    ? "dates"
                    : source.field
                ]
              }
              :
            </b>{" "}
            {source.note}{" "}
            <a href={source.url} target="_blank" rel="noreferrer">
              {t.officialSource}
            </a>{" "}
            <small>
              {t.checked} {date(source.checkedAt)}
            </small>
          </p>
        ))}
      </section>
    </div>
  );
}

export function SharedPlanContent({
  attendance,
  updatedAt,
}: {
  attendance: Record<string, string>;
  updatedAt: string;
}) {
  const { t, dateTime } = usePublicCopy();
  const status = (value: string) =>
    value === "going" || value === "maybe" || value === "not-going"
      ? t.attendanceValues[value]
      : t.unspecified;
  return (
    <div className="plannerPage">
      <div className="plannerHero">
        <div>
          <div className="eyebrow">{t.sharedEyebrow}</div>
          <h1>{t.sharedTitle}</h1>
          <p>
            {t.updated} {dateTime(updatedAt)} UTC
          </p>
        </div>
      </div>
      <section className="plannerSection">
        <h2>{t.attendance}</h2>
        {Object.keys(attendance).length ? (
          <ul>
            {Object.entries(attendance).map(([festival, value]) => (
              <li key={festival}>
                <strong>{festival}</strong> — {status(value)}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t.noAttendance}</p>
        )}
      </section>
    </div>
  );
}

export function CountryContent({
  countryCode,
  country,
  festivals,
  discoveryLineups,
}: {
  countryCode: string;
  country: string;
  festivals: Festival[];
  discoveryLineups?: DiscoveryLineups;
}) {
  const { t, locale } = usePublicCopy();
  const name = new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) || country;
  return (
    <div className="directoryPage">
      <h1>{t.country(name)}</h1>
      <FestivalExplorer festivals={festivals} discoveryLineups={discoveryLineups} />
    </div>
  );
}

export function MonthContent({
  month,
  festivals,
  discoveryLineups,
}: {
  month: string;
  festivals: Festival[];
  discoveryLineups?: DiscoveryLineups;
}) {
  const { t, locale } = usePublicCopy();
  const russianMonths = [
    "январе",
    "феврале",
    "марте",
    "апреле",
    "мае",
    "июне",
    "июле",
    "августе",
    "сентябре",
    "октябре",
    "ноябре",
    "декабре",
  ];
  const name =
    locale === "ru-RU"
      ? russianMonths[Number(month) - 1]
      : new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
          new Date("2027-" + month + "-01T12:00:00Z"),
        );
  return (
    <div className="directoryPage">
      <h1>{t.month(name || month)}</h1>
      <FestivalExplorer festivals={festivals} discoveryLineups={discoveryLineups} />
    </div>
  );
}
