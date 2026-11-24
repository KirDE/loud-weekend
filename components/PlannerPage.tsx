"use client";

import { sendProductEvent } from "@/lib/product-events";
import { favoriteArtistLabels, type FavoriteArtistIdentity } from "@/lib/favorite-artist";
import Link from "next/link";
import { useState } from "react";
import { playlistLineup } from "@/lib/playlist-selection";
import type { DiscoveryLineups } from "@/lib/discovery-sort";
import { festivalDateInterval } from "@/lib/festival-dates";
import { calendarFile } from "@/lib/planning";
import type { Festival } from "@/lib/domain/festival";
import { useLocalPlanner, type Attendance } from "./LocalPlanner";
import { PlannerReset } from "./PlannerReset";
import { AccountSyncPanel } from "./AccountSyncPanel";
import { PersonalCalendar } from "./PersonalCalendar";
import { FestivalViews } from "./FestivalViews";
import { useLanguage, type Language } from "./LanguageProvider";

type PlannerLabels = {
  eyebrow: string;
  title: string;
  intro: string;
  clear: string;
  calendar: string;
  saved: (count: number) => string;
  empty: string;
  emptyHelp: string;
  datesTba: string;
  noStatus: string;
  going: string;
  maybe: string;
  notGoing: string;
  download: string;
  selection: string;
  build: string;
  artists: (count: number) => string;
  favorites: string;
  attendance: string;
  creating: string;
  createPlaylist: string;
  connectSpotify: string;
  playlistCreated: (tracks: number, unmatched: number) => string;
  playlistFailed: string;
  playlistIntro: string;
  openPlaylist: string;
  fallback: string;
  fallbackHelp: string;
  downloadArtists: string;
};

const plannerLabels: Record<Language, PlannerLabels> = {
  en: {
    eyebrow: "LOCAL TRIP PLANNER",
    title: "Your 2027 plan",
    intro:
      "Saved in this browser by default. Sign in below only if you want explicit cross-device sync.",
    clear: "Clear local data",
    calendar: "PERSONAL CALENDAR",
    saved: (count) => `${count} saved ${count === 1 ? "festival" : "festivals"}`,
    empty: "No festivals saved yet.",
    emptyHelp: "Open a festival and choose Save, Going, or Maybe.",
    datesTba: "Dates TBA",
    noStatus: "No status",
    going: "Going",
    maybe: "Maybe",
    notGoing: "Not going",
    download: "Download calendar (.ics)",
    selection: "SELECTION PLAYLIST",
    build: "Build your lineup",
    artists: (count) => `${count} ${count === 1 ? "artist" : "artists"}`,
    favorites: "FAVORITE ARTISTS",
    attendance: "Attendance for",
    creating: "Creating…",
    createPlaylist: "Create private Spotify playlist",
    connectSpotify: "Connect Spotify",
    playlistCreated: (tracks, unmatched) =>
      `Created with ${tracks} tracks${unmatched ? `; ${unmatched} artists could not be matched` : ""}.`,
    playlistFailed: "Playlist creation failed.",
    playlistIntro:
      "Creates one private playlist with one representative track per deduplicated artist.",
    openPlaylist: "Open playlist ↗",
    fallback: "Fallback: export deduplicated artist list",
    fallbackHelp:
      "If sign-in, Spotify credentials, or matching is unavailable," +
      " download this saved selection and import it with a playlist" +
      " transfer tool that supports newline-separated artists.",
    downloadArtists: "Download artist list",
  },
  de: {
    eyebrow: "LOKALER REISEPLANER",
    title: "Dein Plan für 2027",
    intro:
      "Standardmäßig in diesem Browser gespeichert. Melde dich nur für eine geräteübergreifende Synchronisierung an.",
    clear: "Lokale Daten löschen",
    calendar: "PERSÖNLICHER KALENDER",
    saved: (count) =>
      `${count} gespeicherte${count === 1 ? "s" : ""} Festival${count === 1 ? "" : "s"}`,
    empty: "Noch keine Festivals gespeichert.",
    emptyHelp: "Öffne ein Festival und wähle Speichern, Dabei oder Vielleicht.",
    datesTba: "Termine offen",
    noStatus: "Kein Status",
    going: "Dabei",
    maybe: "Vielleicht",
    notGoing: "Nicht dabei",
    download: "Kalender herunterladen (.ics)",
    selection: "PLAYLIST-AUSWAHL",
    build: "Stelle dein Line-up zusammen",
    artists: (count) => `${count} Künstler`,
    favorites: "LIEBLINGSKÜNSTLER",
    attendance: "Teilnahme an",
    creating: "Wird erstellt…",
    createPlaylist: "Private Spotify-Playlist erstellen",
    connectSpotify: "Spotify verbinden",
    playlistCreated: (tracks, unmatched) =>
      `Mit ${tracks} Titeln erstellt${unmatched ? `; ${unmatched} Künstler konnten nicht zugeordnet werden` : ""}.`,
    playlistFailed: "Playlist konnte nicht erstellt werden.",
    playlistIntro:
      "Erstellt eine private Playlist mit je einem repräsentativen Titel pro eindeutigem Künstler.",
    openPlaylist: "Playlist öffnen ↗",
    fallback: "Alternative: eindeutige Künstlerliste exportieren",
    fallbackHelp:
      "Wenn Anmeldung, Spotify-Zugang oder Zuordnung nicht verfügba" +
      "r sind, lade diese gespeicherte Auswahl herunter und importi" +
      "ere sie mit einem Playlist-Transferwerkzeug, das zeilengetre" +
      "nnte Künstler unterstützt.",
    downloadArtists: "Künstlerliste herunterladen",
  },
  ru: {
    eyebrow: "ЛОКАЛЬНЫЙ ПЛАН ПОЕЗДКИ",
    title: "Ваш план на 2027 год",
    intro:
      "По умолчанию данные сохраняются в этом браузере. Войдите только для синхронизации между устройствами.",
    clear: "Удалить локальные данные",
    calendar: "ЛИЧНЫЙ КАЛЕНДАРЬ",
    saved: (count) => `${count} сохранённых фестивалей`,
    empty: "Фестивали ещё не сохранены.",
    emptyHelp: "Откройте фестиваль и выберите «Сохранить», «Пойду» или «Возможно».",
    datesTba: "Даты уточняются",
    noStatus: "Без статуса",
    going: "Пойду",
    maybe: "Возможно",
    notGoing: "Не пойду",
    download: "Скачать календарь (.ics)",
    selection: "ПЛЕЙЛИСТ ПО ВЫБОРУ",
    build: "Соберите свой лайнап",
    artists: (count) => `${count} артистов`,
    favorites: "ЛЮБИМЫЕ АРТИСТЫ",
    attendance: "Посещение",
    creating: "Создание…",
    createPlaylist: "Создать приватный плейлист Spotify",
    connectSpotify: "Подключить Spotify",
    playlistCreated: (tracks, unmatched) =>
      `Создано треков: ${tracks}${unmatched ? `; не удалось сопоставить артистов: ${unmatched}` : ""}.`,
    playlistFailed: "Не удалось создать плейлист.",
    playlistIntro:
      "Создаёт один приватный плейлист с одним характерным треком каждого уникального артиста.",
    openPlaylist: "Открыть плейлист ↗",
    fallback: "Запасной вариант: экспорт уникального списка артистов",
    fallbackHelp:
      "Если вход, доступ к Spotify или сопоставление недоступны, ск" +
      "ачайте сохранённый список и импортируйте его через сервис пе" +
      "реноса плейлистов с поддержкой артистов, разделённых строкам" +
      "и.",
    downloadArtists: "Скачать список артистов",
  },
};
const playlistCopy = {
  en: {
    choose: "Choose artists",
    all: "Include all artists",
    favorites: "Include only favorites",
    limit:
      "Spotify accepts up to 250 artists and 50 festivals per request. Narrow the selection or export the artist list.",
  },
  de: {
    choose: "Künstler auswählen",
    all: "Alle Künstler auswählen",
    favorites: "Nur Lieblingskünstler auswählen",
    limit:
      "Spotify erlaubt bis zu 250 Künstler und 50 Festivals. Passe die Auswahl an oder exportiere die Liste.",
  },
  ru: {
    choose: "Выбрать артистов",
    all: "Включить всех артистов",
    favorites: "Оставить только любимых",
    limit: "Лимит Spotify: 250 артистов и 50 фестивалей. Сократите выбор или экспортируйте список.",
  },
};

export function PlannerPage({
  festivals,
  catalogueArtists,
  lineups,
}: {
  festivals: Festival[];
  catalogueArtists: FavoriteArtistIdentity[];
  lineups: DiscoveryLineups;
}) {
  const { language } = useLanguage();
  const t = plannerLabels[language];
  const p = useLocalPlanner();
  const copy = playlistCopy[language];
  const [syncBusy, setSyncBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [playlist, setPlaylist] = useState<{
    status: "idle" | "creating" | "created" | "error";
    message?: string;
    url?: string;
  }>({ status: "idle" });
  const planned = festivals.filter(
    (f) => p.favoriteFestivals.includes(f.slug) || p.attendance[f.slug],
  );
  const selected = festivals.filter((f) => p.playlistFestivals.includes(f.slug));
  const candidates = playlistLineup(
    selected.map((festival) => festival.slug),
    lineups,
    catalogueArtists,
  );
  const excluded = new Set(p.playlistExcludedArtists ?? []);
  const favorites = new Set(
    p.favoriteArtists.map((key) =>
      key.startsWith("artist:")
        ? key.slice("artist:".length)
        : Object.hasOwn(lineups.legacyFavoriteSlugs, key)
          ? lineups.legacyFavoriteSlugs[key]
          : undefined,
    ),
  );
  const artists = [
    ...new Set(
      candidates.filter((artist) => !excluded.has(artist.slug)).map((artist) => artist.name),
    ),
  ].sort();
  const exceedsProviderLimit = artists.length > 250 || selected.length > 50;

  function selectArtists(favoritesOnly: boolean) {
    const next = new Set(excluded);
    for (const { slug } of candidates) {
      if (favoritesOnly && !favorites.has(slug)) next.add(slug);
      else next.delete(slug);
    }
    p.setPlaylistExclusions([...next]);
  }
  const dated = planned
    .filter((f) => festivalDateInterval(f))
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  async function createPlaylist() {
    sendProductEvent("PLAYLIST_START", language);
    setPlaylist({ status: "creating", message: t.creating });
    try {
      const response = await fetch("/api/spotify/selection-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artists, festivals: selected.map((festival) => festival.name) }),
      });
      const result = (await response.json()) as {
        error?: string;
        playlistUrl?: string;
        trackCount?: number;
        unresolved?: string[];
      };
      if (!response.ok || !result.playlistUrl) throw new Error(t.playlistFailed);
      sendProductEvent("PLAYLIST_SUCCESS", language);
      setPlaylist({
        status: "created",
        url: result.playlistUrl,
        message: t.playlistCreated(result.trackCount || 0, result.unresolved?.length || 0),
      });
    } catch {
      setPlaylist({ status: "error", message: t.playlistFailed });
    }
  }
  return (
    <div className="plannerPage">
      <FestivalViews festivals={festivals} />
      <div className="plannerHero">
        <div>
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <PlannerReset
          disabled={syncBusy || playlist.status === "creating"}
          onOpenChange={setResetOpen}
        />
      </div>
      {p.ready && (
        <>
          <AccountSyncPanel disabled={resetOpen} onBusyChange={setSyncBusy} />
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">{t.calendar}</div>
                <h2>{t.saved(planned.length)}</h2>
              </div>
            </div>
            {!planned.length && (
              <div className="lineupEmpty">
                <strong>{t.empty}</strong>
                <span>{t.emptyHelp}</span>
              </div>
            )}
            <div className="planList">
              {planned.map((f) => (
                <article key={f.slug}>
                  <div>
                    <small>{f.startDate || t.datesTba}</small>
                    <Link href={`/festivals/${f.slug}/`}>
                      <strong>{f.name}</strong>
                    </Link>
                    <span>
                      {f.city} · {f.countryCode}
                    </span>
                  </div>
                  <select
                    value={p.attendance[f.slug] || ""}
                    aria-label={`${t.attendance} ${f.name}`}
                    onChange={(e) =>
                      p.setAttendance(
                        f.slug,
                        (e.target.value || undefined) as Attendance | undefined,
                      )
                    }
                  >
                    <option value="">{t.noStatus}</option>
                    <option value="going">{t.going}</option>
                    <option value="maybe">{t.maybe}</option>
                    <option value="not-going">{t.notGoing}</option>
                  </select>
                </article>
              ))}
            </div>
            {!!dated.length && (
              <a
                className="primaryButton"
                href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`}
                download="loud-weekend-2027.ics"
              >
                {t.download}
              </a>
            )}
          </section>
          <PersonalCalendar festivals={festivals} />
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">{t.selection}</div>
                <h2>{t.build}</h2>
              </div>
              <span>{t.artists(artists.length)}</span>
            </div>
            <div className="playlistFestivalGrid">
              {festivals.map((f) => (
                <label key={f.slug}>
                  <input
                    type="checkbox"
                    disabled={syncBusy}
                    checked={p.playlistFestivals.includes(f.slug)}
                    onChange={() => p.togglePlaylistFestival(f.slug)}
                  />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
            {!!candidates.length && (
              <details className="playlistArtistPicker">
                <summary>{copy.choose}</summary>
                <div className="playlistActions">
                  <button
                    type="button"
                    className="outlineButton"
                    disabled={syncBusy}
                    onClick={() => selectArtists(false)}
                  >
                    {copy.all}
                  </button>
                  <button
                    type="button"
                    className="outlineButton"
                    disabled={syncBusy}
                    onClick={() => selectArtists(true)}
                  >
                    {copy.favorites}
                  </button>
                </div>
                <div className="playlistFestivalGrid">
                  {candidates.map(({ slug, name }) => (
                    <label key={slug}>
                      <input
                        type="checkbox"
                        disabled={syncBusy}
                        checked={!excluded.has(slug)}
                        onChange={() => p.togglePlaylistArtist(slug)}
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            {!!artists.length && (
              <div>
                <div className="playlistActions">
                  <button
                    className="primaryButton"
                    type="button"
                    disabled={playlist.status === "creating" || exceedsProviderLimit}
                    onClick={createPlaylist}
                  >
                    {playlist.status === "creating" ? t.creating : t.createPlaylist}
                  </button>
                  <a className="outlineButton" href="/api/spotify/connect">
                    {t.connectSpotify}
                  </a>
                </div>
                <p className={`playlistStatus ${playlist.status}`} role="status">
                  {exceedsProviderLimit ? copy.limit : playlist.message || t.playlistIntro}
                  {playlist.url && (
                    <>
                      {" "}
                      <a href={playlist.url} target="_blank" rel="noreferrer">
                        {t.openPlaylist}
                      </a>
                    </>
                  )}
                </p>
                <details>
                  <summary>{t.fallback}</summary>
                  <p>{t.fallbackHelp}</p>
                  <a
                    className="outlineButton"
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(artists.join("\n"))}`}
                    download="loud-weekend-playlist-artists.txt"
                  >
                    {t.downloadArtists}
                  </a>
                </details>
              </div>
            )}
          </section>
          {!!p.favoriteArtists.length && (
            <section className="plannerSection">
              <div className="eyebrow">{t.favorites}</div>
              <div className="artistChips">
                {favoriteArtistLabels(p.favoriteArtists, catalogueArtists).map(([key, name]) => (
                  <span key={key}>{name}</span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
