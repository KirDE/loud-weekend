"use client";

import { CalendarSubscription } from "./CalendarSubscription";
import { useEffect, useState } from "react";
import { z } from "zod";
import { readTripBudgets } from "@/lib/trip-budget";
import { readDiscoveryPreferences } from "@/lib/discovery-preferences";
import { readCollections, mergeCollections } from "@/lib/collections";
import { readSeasonAttendance } from "@/lib/planner-storage";
import { useLanguage } from "./LanguageProvider";
import { emptyPlannerState, type PlannerState, useLocalPlanner } from "./LocalPlanner";
type Kind =
  "favorites" | "collections" | "saved-filters" | "plans" | "season-attendance" | "budgets";
type Document = { id: string; payload: unknown; revision: number; updatedAt: string };
type ConflictMode = "replace" | "merge" | "spotify";
type Conflict = { kind: Kind; remote: Document; mode: ConflictMode };
const kinds: Kind[] = [
  "favorites",
  "collections",
  "saved-filters",
  "plans",
  "season-attendance",
  "budgets",
];
const documentKinds: Record<Kind, string> = {
  favorites: "FAVORITES",
  collections: "COLLECTIONS",
  "saved-filters": "SAVED_FILTERS",
  plans: "FESTIVAL_PLANS",
  "season-attendance": "SEASON_ATTENDANCE",
  budgets: "TRIP_BUDGETS",
};
const favoritesPayload = z.object({
  favoriteFestivals: z.array(z.string()).optional(),
  favoriteArtists: z.array(z.string()).optional(),
});
const plansPayload = z.object({
  attendance: z.record(z.string(), z.enum(["going", "maybe", "not-going"])).optional(),
});
const savedFiltersPayload = z.object({
  savedFilters: z
    .object({
      query: z.string(),
      country: z.string(),
      announcedOnly: z.boolean(),
      month: z.string(),
      ticketsOnly: z.boolean(),
      genre: z.string(),
      origin: z.string(),
      maxDistance: z.string(),
    })
    .partial(),
});
const labels = {
  en: {
    title: "Account sync",
    local: "Your local plan remains available while signed out.",
    season: "Attendance from other seasons stays private and is not included in public plan links.",
    migrate: "Merge this device into my account",
    replace: "Use account data on this device",
    noAccountData: "No account data to use yet.",
    sync: "Sync now",
    syncing: "Syncing…",
    current: "Everything is synchronized.",
    resolved: "Conflict resolved. Sync again to send other local changes.",
    conflict: "A newer version exists on another device. Nothing was overwritten.",
    keepLocal: "Keep this device",
    keepRemote: "Use other device",
    share: "Create public plan link",
    expiry: "Link expiry",
    copy: "Copy link",
    copied: "Copied",
    expired: "Expired links return Not Found.",
    spotify: "Spotify",
    connect: "Connect or reconnect Spotify",
    import: "Import playlists",
    last: "Last successful import",
    imported: "Saved imported playlists",
    empty: "No imported playlists yet.",
    tracks: "tracks",
    failed: "Sync failed. Reconnect and try again.",
    login: "Sign in from the Account menu to enable cross-device sync.",
  },
  de: {
    title: "Konto-Synchronisierung",
    local: "Dein lokaler Plan bleibt ohne Anmeldung verfügbar.",
    season:
      "Teilnahmeangaben aus anderen Saisons bleiben privat und erscheinen nicht in öffentlichen Plan-Links.",
    migrate: "Dieses Gerät mit meinem Konto zusammenführen",
    replace: "Kontodaten auf diesem Gerät verwenden",
    noAccountData: "Im Konto sind noch keine Daten gespeichert.",
    sync: "Jetzt synchronisieren",
    syncing: "Synchronisiere…",
    current: "Alles ist synchronisiert.",
    resolved: "Konflikt gelöst. Synchronisiere erneut, um weitere lokale Änderungen zu übertragen.",
    conflict: "Auf einem anderen Gerät gibt es eine neuere Version. Nichts wurde überschrieben.",
    keepLocal: "Dieses Gerät behalten",
    keepRemote: "Anderes Gerät verwenden",
    share: "Öffentlichen Plan-Link erstellen",
    expiry: "Link-Ablauf",
    copy: "Link kopieren",
    copied: "Kopiert",
    expired: "Abgelaufene Links zeigen „Nicht gefunden“.",
    spotify: "Spotify",
    connect: "Spotify verbinden oder neu verbinden",
    import: "Playlists importieren",
    last: "Letzter erfolgreicher Import",
    imported: "Gespeicherte importierte Playlists",
    empty: "Noch keine Playlists importiert.",
    tracks: "Titel",
    failed: "Synchronisierung fehlgeschlagen. Neu verbinden und erneut versuchen.",
    login: "Im Konto-Menü anmelden, um geräteübergreifend zu synchronisieren.",
  },
  ru: {
    title: "Синхронизация аккаунта",
    local: "Без входа локальный план останется доступен.",
    season: "Отметки об участии в других сезонах остаются личными и не видны по публичным ссылкам.",
    migrate: "Объединить данные устройства с аккаунтом",
    replace: "Использовать данные аккаунта на устройстве",
    noAccountData: "В аккаунте пока нет сохранённых данных.",
    sync: "Синхронизировать",
    syncing: "Синхронизация…",
    current: "Всё синхронизировано.",
    resolved:
      "Конфликт решён. Запустите синхронизацию ещё раз, чтобы отправить остальные локальные изменения.",
    conflict: "На другом устройстве есть более новая версия. Ничего не перезаписано.",
    keepLocal: "Оставить данные устройства",
    keepRemote: "Взять данные другого устройства",
    share: "Создать публичную ссылку на план",
    expiry: "Срок ссылки",
    copy: "Копировать ссылку",
    copied: "Скопировано",
    expired: "Истёкшие ссылки возвращают «Не найдено».",
    spotify: "Spotify",
    connect: "Подключить или переподключить Spotify",
    import: "Импортировать плейлисты",
    last: "Последний успешный импорт",
    imported: "Сохранённые импортированные плейлисты",
    empty: "Плейлисты ещё не импортированы.",
    tracks: "треков",
    failed: "Ошибка синхронизации. Переподключитесь и повторите.",
    login: "Войдите через меню аккаунта, чтобы включить синхронизацию между устройствами.",
  },
} as const;
function playlistSelection(value: unknown) {
  const { playlistFestivals, playlistExcludedArtists } = readCollections(value);
  return { playlistFestivals, playlistExcludedArtists };
}
function spotifySelection(remote: unknown, planner: ReturnType<typeof useLocalPlanner>) {
  const collections = readCollections(remote);
  return {
    ...mergeCollections(collections, { playlistFestivals: planner.playlistFestivals }),
    playlistExcludedArtists: planner.playlistExcludedArtists ?? collections.playlistExcludedArtists,
  };
}
function payloads(p: ReturnType<typeof useLocalPlanner>): Record<Kind, unknown> {
  return {
    favorites: { favoriteFestivals: p.favoriteFestivals, favoriteArtists: p.favoriteArtists },
    collections: readCollections({
      playlistFestivals: p.playlistFestivals,
      playlistExcludedArtists: p.playlistExcludedArtists,
    }),
    "saved-filters": { savedFilters: p.savedFilters },
    plans: { attendance: p.attendance },
    "season-attendance": { seasonAttendance: p.seasonAttendance ?? {} },
    budgets: p.tripBudgets,
  };
}
function plannerFrom(documents: Partial<Record<Kind, Document>>): PlannerState {
  const favorites = documents.favorites?.payload as z.infer<typeof favoritesPayload> | undefined;
  const plans = documents.plans?.payload as z.infer<typeof plansPayload> | undefined;
  const filters = documents["saved-filters"]?.payload as { savedFilters?: unknown } | undefined;
  const season = documents["season-attendance"];
  return {
    favoriteFestivals: favorites?.favoriteFestivals ?? emptyPlannerState.favoriteFestivals,
    favoriteArtists: favorites?.favoriteArtists ?? emptyPlannerState.favoriteArtists,
    attendance: plans?.attendance ?? emptyPlannerState.attendance,
    ...playlistSelection(documents.collections?.payload),
    savedFilters: readDiscoveryPreferences(filters?.savedFilters),
    seasonAttendance: season
      ? readSeasonAttendance(
          (season.payload as { seasonAttendance?: unknown } | null)?.seasonAttendance,
        )
      : undefined,
    tripBudgets: readTripBudgets(documents.budgets?.payload),
  };
}
function mergePayload(kind: Kind, remote: unknown, local: unknown) {
  const a = remote as Partial<PlannerState>;
  const b = local as Partial<PlannerState>;
  if (kind === "favorites")
    return {
      favoriteFestivals: Array.from(
        new Set([...(a.favoriteFestivals || []), ...(b.favoriteFestivals || [])]),
      ),
      favoriteArtists: Array.from(
        new Set([...(a.favoriteArtists || []), ...(b.favoriteArtists || [])]),
      ),
    };
  if (kind === "collections") return mergeCollections(remote, local);
  if (kind === "season-attendance")
    return {
      seasonAttendance: {
        ...readSeasonAttendance(a.seasonAttendance),
        ...readSeasonAttendance(b.seasonAttendance),
      },
    };
  if (kind === "plans") return { attendance: { ...a.attendance, ...b.attendance } };
  if (kind === "budgets") return { ...readTripBudgets(remote), ...readTripBudgets(local) };
  return { ...a, ...b };
}
export function AccountSyncPanel({
  disabled = false,
  onBusyChange,
}: { disabled?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const planner = useLocalPlanner();
  const { language, locale } = useLanguage();
  const t = labels[language];
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [docs, setDocs] = useState<Partial<Record<Kind, Document>>>({});
  const [busy, setBusyState] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [expiry, setExpiry] = useState("");
  function setBusy(value: boolean) {
    setBusyState(value);
    onBusyChange?.(value);
  }
  const syncHeaders = (accountId: string) => ({ "X-Sync-Account": accountId });
  async function parseDocument(kind: Kind, response: Response, accountId: string) {
    const document = (await response.json().catch(() => null))?.document as
      (Document & { kind?: string; userId?: string }) | null | undefined;
    if (document === null) return null;
    if (
      !document ||
      document.userId !== accountId ||
      typeof document.id !== "string" ||
      !document.id ||
      !Number.isSafeInteger(document.revision) ||
      document.revision < 1 ||
      document.payload === undefined ||
      document.kind !== documentKinds[kind]
    ) {
      throw new Error(t.failed);
    }
    if (kind === "collections") readCollections(document.payload);
    if (kind === "favorites" && !favoritesPayload.safeParse(document.payload).success)
      throw new Error(t.failed);
    if (kind === "plans" && !plansPayload.safeParse(document.payload).success)
      throw new Error(t.failed);
    if (kind === "saved-filters" && !savedFiltersPayload.safeParse(document.payload).success)
      throw new Error(t.failed);
    return document;
  }

  async function readWriteAcknowledgement(
    kind: Kind,
    response: Response,
    accountId: string,
    base?: Document,
  ) {
    if (!response.ok) throw new Error(t.failed);
    const document = await parseDocument(kind, response, accountId);
    if (
      !document ||
      document.revision !== (base?.revision ?? 0) + 1 ||
      (base && document.id !== base.id)
    )
      throw new Error(t.failed);
    return document;
  }

  async function readDocument(kind: Kind, accountId: string, signal?: AbortSignal) {
    const response = await fetch("/api/sync/" + kind, {
      cache: "no-store",
      headers: syncHeaders(accountId),
      signal,
    });
    if (!response.ok) throw new Error(t.failed);
    return parseDocument(kind, response, accountId);
  }

  async function readDocuments(accountId: string, signal?: AbortSignal) {
    const entries = await Promise.all(
      kinds.map(async (kind) => [kind, await readDocument(kind, accountId, signal)] as const),
    );
    return Object.fromEntries(entries.filter(([, document]) => document)) as Partial<
      Record<Kind, Document>
    >;
  }

  const [baseline, setBaseline] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let active: AbortController | undefined;
    async function load() {
      active?.abort();
      const { signal } = (active = new AbortController());
      setBaseline("loading");
      setUser(null);
      setDocs({});
      setConflict(null);
      setShareUrl("");
      setStatus("");
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (me.status === 401) {
          setBaseline("ready");
          return;
        }
        if (!me.ok) throw new Error(t.failed);
        const { user: account } = await me.json();
        if (signal.aborted) return;
        if (!account?.id) throw new Error(t.failed);
        setUser(account);
        const documents = await readDocuments(account.id, signal);
        if (signal.aborted) return;
        setDocs(documents);
        setBaseline("ready");
      } catch {
        if (signal.aborted) return;
        setBaseline("failed");
        setStatus(t.failed);
      }
    }
    const listener = () => void load();
    void load();
    window.addEventListener("loud-weekend-authenticated", listener);
    window.addEventListener("loud-weekend-signed-out", listener);
    return () => {
      active?.abort();
      window.removeEventListener("loud-weekend-authenticated", listener);
      window.removeEventListener("loud-weekend-signed-out", listener);
    };
  }, []);
  async function put(
    kind: Kind,
    payload: unknown,
    base?: Document,
    mode: ConflictMode = "replace",
  ) {
    if (!user) throw new Error(t.failed);
    const accountId = user.id;
    const revision = base?.revision ?? 0;
    const response = await fetch(`/api/sync/${kind}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, revision, accountId }),
    });
    if (response.status === 409) {
      const latest = await readDocument(kind, accountId);
      if (!latest) throw new Error(t.failed);
      setConflict({ kind, remote: latest, mode });
      throw new Error("conflict");
    }
    const document = await readWriteAcknowledgement(kind, response, accountId, base);
    setDocs((current) => ({ ...current, [kind]: document }));
    return document;
  }
  function accountDocumentFields(kind: Kind, document: Document) {
    const state = plannerFrom({ [kind]: document });
    const fields = {
      favorites: {
        favoriteFestivals: state.favoriteFestivals,
        favoriteArtists: state.favoriteArtists,
      },
      collections: {
        playlistFestivals: state.playlistFestivals,
        playlistExcludedArtists: state.playlistExcludedArtists,
      },
      "saved-filters": { savedFilters: state.savedFilters },
      plans: { attendance: state.attendance },
      "season-attendance": { seasonAttendance: state.seasonAttendance },
      budgets: { tripBudgets: state.tripBudgets },
    };
    return fields[kind];
  }

  async function synchronize(mode: "merge" | "remote" | "normal" = "normal") {
    setBusy(true);
    setStatus("");
    setConflict(null);
    const merged: Partial<PlannerState> = {};
    try {
      if (mode === "remote") {
        if (!user) throw new Error(t.failed);
        const latest = await readDocuments(user.id);
        setDocs(latest);
        if (!Object.keys(latest).length) {
          setStatus(t.noAccountData);
          return;
        }
        for (const kind of kinds) {
          const document = latest[kind];
          if (document) planner.replaceFields(accountDocumentFields(kind, document), planner);
        }
        setStatus(t.current);
        return;
      }
      const local = payloads(planner);
      for (const kind of kinds) {
        const remote = docs[kind];
        if (kind === "season-attendance" && !remote && !planner.seasonAttendance) continue;
        if (kind === "budgets" && !remote && !Object.keys(planner.tripBudgets).length) continue;
        const content =
          mode === "merge" && remote
            ? mergePayload(kind, remote.payload, local[kind])
            : local[kind];
        const saved = await put(kind, content, remote, mode === "merge" ? "merge" : "replace");
        if (mode === "merge") Object.assign(merged, accountDocumentFields(kind, saved));
      }
      setStatus(t.current);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "conflict"))
        setStatus(reason instanceof Error ? reason.message : t.failed);
    } finally {
      // Keep the account changes that were saved before a later document failed.
      if (Object.keys(merged).length) planner.merge(merged, planner);
      setBusy(false);
    }
  }

  async function resolve(useLocal: boolean) {
    if (!user || !conflict) return;
    setBusy(true);
    try {
      const { kind, remote, mode } = conflict;
      if (useLocal) {
        const local = payloads(planner)[kind];
        let content = local;
        if (mode === "merge") content = mergePayload(kind, remote.payload, local);
        if (mode === "spotify") content = spotifySelection(remote.payload, planner);
        const saved = await put(kind, content, remote, mode);
        if (mode === "merge") planner.merge(accountDocumentFields(kind, saved), planner);
      } else {
        const latest = await readDocument(kind, user.id);
        if (!latest || latest.id !== remote.id) throw new Error(t.failed);
        planner.replaceFields(accountDocumentFields(kind, latest), planner);
        setDocs((current) => ({ ...current, [kind]: latest }));
      }
      setConflict(null);
      setStatus(t.resolved);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "conflict")) setStatus(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    setStatus("");
    try {
      let plan = docs.plans;
      if (!plan) plan = await put("plans", { attendance: planner.attendance });
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: plan.id,
          expiresAt: expiry ? new Date(`${expiry}T23:59:59.999Z`).toISOString() : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(t.failed);
      setShareUrl(`${location.origin}/share/${body.share.slug}/`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function spotifySync() {
    if (!user) return;
    const accountId = user.id;
    setBusy(true);
    setStatus("");
    setConflict(null);
    try {
      // Preserve unsynchronized device selection first, under the same revision
      // checks as normal sync. A conflict aborts before calling the provider.
      const selection = spotifySelection(docs.collections?.payload, planner);
      const saved = await put("collections", selection, docs.collections, "spotify");
      planner.merge(playlistSelection(saved.payload), planner);
      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: saved.revision }),
      });
      if (response.status === 409) {
        const document = await readDocument("collections", accountId);
        if (!document) throw new Error(t.failed);
        setConflict({ kind: "collections", remote: document, mode: "spotify" });
        setStatus(t.conflict);
        return;
      }
      const document = await readWriteAcknowledgement("collections", response, accountId, saved);
      setDocs((value) => ({ ...value, collections: document }));
      setStatus(t.current);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "conflict")) setStatus(t.failed);
    } finally {
      setBusy(false);
    }
  }
  const imported = readCollections(docs.collections?.payload).spotify;

  const syncing = busy || baseline === "loading";
  const actionsDisabled = busy || disabled || baseline !== "ready";
  if (!user)
    return (
      <section className="plannerSection accountSync">
        <h2>{t.title}</h2>
        <p>{t.local}</p>
        <strong>{t.login}</strong>
        {baseline === "failed" && <p role="status">{status}</p>}
      </section>
    );
  return (
    <section className="plannerSection accountSync" aria-busy={syncing}>
      <div className="sectionHeading">
        <div>
          <div className="eyebrow">{user.email}</div>
          <h2>{t.title}</h2>
        </div>
        <span aria-live="polite">{syncing ? t.syncing : status}</span>
      </div>
      <div className="syncActions">
        <button disabled={actionsDisabled} onClick={() => synchronize("merge")}>
          {t.migrate}
        </button>
        <button disabled={actionsDisabled} onClick={() => synchronize("remote")}>
          {t.replace}
        </button>
        <button disabled={actionsDisabled} onClick={() => synchronize()}>
          {t.sync}
        </button>
      </div>
      <p>{t.season}</p>
      {conflict && (
        <div className="syncConflict" role="alert">
          <strong>{t.conflict}</strong>
          <div>
            <button disabled={actionsDisabled} onClick={() => resolve(true)}>
              {t.keepLocal}
            </button>
            <button disabled={actionsDisabled} onClick={() => resolve(false)}>
              {t.keepRemote}
            </button>
          </div>
        </div>
      )}
      <div className="syncGrid">
        <div>
          <h3>{t.share}</h3>
          <label>
            {t.expiry}
            <input
              type="date"
              value={expiry}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </label>
          <button disabled={actionsDisabled} onClick={share}>
            {t.share}
          </button>
          {shareUrl && (
            <div className="shareResult">
              <a href={shareUrl}>{shareUrl}</a>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(shareUrl);
                  setStatus(t.copied);
                }}
              >
                {t.copy}
              </button>
            </div>
          )}
          <small>{t.expired}</small>
        </div>
        <div>
          <h3>{t.spotify}</h3>
          <a className="outlineButton" href="/api/spotify/connect">
            {t.connect}
          </a>
          <button disabled={actionsDisabled} onClick={spotifySync}>
            {t.import}
          </button>
          {imported ? (
            <div className="importedCollections">
              <p>
                {t.last}:{" "}
                <time dateTime={imported.syncedAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(imported.syncedAt))}
                </time>
              </p>
              <h4>{t.imported}</h4>
              <ul>
                {imported.playlists.map((playlist) => (
                  <li key={playlist.id}>
                    <a href={playlist.url} target="_blank" rel="noopener noreferrer">
                      {playlist.name}
                    </a>
                    <span>
                      {" "}
                      · {playlist.trackCount} {t.tracks}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>{t.empty}</p>
          )}
        </div>
        <CalendarSubscription key={user.id} disabled={busy || disabled} />
      </div>
    </section>
  );
}
